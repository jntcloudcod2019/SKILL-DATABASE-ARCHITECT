import {
  applyNaming, findEntity, physicalColumn, physicalTable,
  type Attribute, type CanonicalModel, type Entity, type Generator, type GeneratorInput, type GeneratorReport, type Relationship,
} from '@dbarchitect/core';

const PROVIDER: Record<string, string> = { postgresql: 'postgresql', sqlserver: 'sqlserver', mysql: 'mysql', sqlite: 'sqlite' };
const ACTION: Record<string, string> = { cascade: 'Cascade', restrict: 'Restrict', 'set-null': 'SetNull', 'no-action': 'NoAction', 'set-default': 'SetDefault' };

const pascal = (s: string) => applyNaming(s, 'PascalCase');
const camel = (s: string) => applyNaming(s, 'camelCase');

function plural(s: string): string {
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + 'ies';
  return s + 's';
}

function prismaType(a: Attribute, dialect: string, enumName: string | undefined, report: GeneratorReport, where: string): { type: string; attrs: string[] } {
  const attrs: string[] = [];
  const db = (t: string) => attrs.push(`@db.${t}`);
  const nativeOk = dialect !== 'sqlite';
  switch (a.domainType) {
    case 'string': if (a.length && nativeOk) db(dialect === 'sqlserver' ? `NVarChar(${a.length})` : `VarChar(${a.length})`); return { type: 'String', attrs };
    case 'text': return { type: 'String', attrs };
    case 'enum': return { type: enumName ?? 'String', attrs };
    case 'integer': return { type: 'Int', attrs };
    case 'bigint': return { type: 'BigInt', attrs };
    case 'decimal': case 'money':
      if (nativeOk) db(`Decimal(${a.precision ?? 18}, ${a.scale ?? (a.domainType === 'money' ? 2 : 0)})`);
      else report.warnings.push(`${where}: Decimal sem precisão fixa no SQLite (armazenado como NUMERIC).`);
      return { type: 'Decimal', attrs };
    case 'boolean': return { type: 'Boolean', attrs };
    case 'date': if (nativeOk) db('Date'); return { type: 'DateTime', attrs };
    case 'datetime': return { type: 'DateTime', attrs };
    case 'time': if (nativeOk) db('Time(6)'); return { type: 'DateTime', attrs };
    case 'uuid': if (dialect === 'postgresql') db('Uuid'); return { type: 'String', attrs };
    case 'json': return { type: 'Json', attrs };
    case 'binary': return { type: 'Bytes', attrs };
  }
}

function defaultAttr(a: Attribute, report: GeneratorReport, where: string): string | undefined {
  if (a.generated === 'identity') return '@default(autoincrement())';
  if (a.generated === 'uuid') return '@default(uuid())';
  if (a.generated === 'now') return '@default(now())';
  if (!a.default) return undefined;
  if (a.default.kind === 'expression') return `@default(dbgenerated("${a.default.value.replace(/"/g, '\\"')}"))`;
  const v = a.default.value;
  if (['integer', 'bigint', 'decimal', 'money'].includes(a.domainType)) return `@default(${v})`;
  if (a.domainType === 'boolean') return `@default(${/^(true|1)$/i.test(v)})`;
  if (a.domainType === 'enum' || a.enumRef) return `@default(${v})`;
  if (a.domainType === 'string' || a.domainType === 'text') return `@default("${v.replace(/"/g, '\\"')}")`;
  report.warnings.push(`${where}: default "${v}" não convertido; use expression.`);
  return undefined;
}

export function generatePrisma(model: CanonicalModel, dialect: string): { schema: string; report: GeneratorReport } {
  const report: GeneratorReport = { notes: [], warnings: [], unsupported: [] };
  const entities = model.entities.filter((e) => e.persistence === 'persistent');
  const names = new Map(entities.map((e) => [e.id, pascal(e.name)]));
  const fieldName = (a: Attribute) => camel(a.name);
  const useEnums = dialect === 'postgresql' || dialect === 'mysql';
  if (!useEnums && model.enums.length) report.notes.push(`Enums emitidos como String: ${dialect} não suporta enums nativos no Prisma; use validação na aplicação ou CHECK.`);

  // extra (relation) fields per model
  const extra = new Map<string, string[]>(entities.map((e) => [e.id, []]));
  const rels = model.relationships.filter((r) => r.cardinality !== 'N:N' && names.has(r.from.entity) && names.has(r.to.entity) && r.from.attributes.length);
  const pairCount = new Map<string, number>();
  for (const r of rels) { const k = [r.from.entity, r.to.entity].sort().join('|'); pairCount.set(k, (pairCount.get(k) ?? 0) + 1); }
  const used = new Map(entities.map((e) => [e.id, new Set(e.attributes.map(fieldName))]));
  const uniqueField = (eid: string, base: string) => { const s = used.get(eid)!; let n = base, i = 2; while (s.has(n)) n = base + i++; s.add(n); return n; };

  for (const r of rels) {
    const from = findEntity(model, r.from.entity)!;
    const to = findEntity(model, r.to.entity)!;
    const multiple = (pairCount.get([r.from.entity, r.to.entity].sort().join('|')) ?? 0) > 1;
    const relName = multiple ? `"${pascal(r.name ?? r.id)}"` : undefined;
    const fkAttrs = r.from.attributes.map((id) => from.attributes.find((a) => a.id === id)!);
    const toIds = r.to.attributes.length ? r.to.attributes : to.attributes.filter((a) => a.primaryKey).map((a) => a.id);
    const toAttrs = toIds.map((id) => to.attributes.find((a) => a.id === id)!);
    const optional = fkAttrs.some((a) => a.nullable);
    const args = [relName, `fields: [${fkAttrs.map(fieldName).join(', ')}]`, `references: [${toAttrs.map(fieldName).join(', ')}]`, `onDelete: ${ACTION[r.onDelete]}`, r.onUpdate ? `onUpdate: ${ACTION[r.onUpdate]}` : undefined].filter(Boolean).join(', ');
    const fwd = uniqueField(from.id, camel(to.name));
    extra.get(from.id)!.push(`  ${fwd} ${names.get(to.id)}${optional ? '?' : ''} @relation(${args})`);
    const backBase = r.cardinality === '1:1' ? camel(from.name) : camel(plural(from.name));
    const back = uniqueField(to.id, backBase);
    const backArgs = relName ? `(${relName})` : '';
    extra.get(to.id)!.push(r.cardinality === '1:1' ? `  ${back} ${names.get(from.id)}?${backArgs ? ' @relation' + backArgs : ''}` : `  ${back} ${names.get(from.id)}[]${backArgs ? ' @relation' + backArgs : ''}`);
  }
  for (const r of model.relationships.filter((x) => x.cardinality === 'N:N'))
    report.notes.push(`Relacionamento N:N ${r.name ?? r.id}: modelado pela entidade de associação (${r.through ?? 'não definida'}); relação implícita do Prisma não é usada.`);

  const out: string[] = [
    '// Generated by Database Architect Studio. Model revision ' + model.status.revision + '.',
    'generator client {', '  provider = "prisma-client-js"', '}', '',
    'datasource db {', `  provider = "${PROVIDER[dialect]}"`, '  url      = env("DATABASE_URL")', '}', '',
  ];
  if (useEnums)
    for (const en of model.enums) out.push(`enum ${pascal(en.name)} {`, ...en.values.map((v) => `  ${v}`), '}', '');

  for (const e of entities) {
    const pks = e.attributes.filter((a) => a.primaryKey);
    const lines: string[] = [];
    for (const a of e.attributes) {
      const where = `${e.name}.${a.name}`;
      const en = useEnums && a.enumRef ? model.enums.find((x) => x.id === a.enumRef) : undefined;
      const t = prismaType(a, dialect, en ? pascal(en.name) : undefined, report, where);
      const attrs: string[] = [];
      if (pks.length === 1 && a.primaryKey) attrs.push('@id');
      const d = defaultAttr(a, report, where);
      if (d) attrs.push(d);
      if (a.unique && !a.primaryKey) attrs.push('@unique');
      attrs.push(...t.attrs);
      const col = physicalColumn(model, a);
      if (col !== fieldName(a)) attrs.push(`@map("${col}")`);
      lines.push(`  ${fieldName(a)} ${t.type}${a.nullable && !a.primaryKey ? '?' : ''}${attrs.length ? ' ' + attrs.join(' ') : ''}`);
    }
    lines.push(...extra.get(e.id)!);
    if (pks.length > 1) lines.push('', `  @@id([${pks.map(fieldName).join(', ')}])`);
    if (!pks.length) report.warnings.push(`${e.name} não tem chave primária; o Prisma exige @id ou @@unique.`);
    for (const u of e.uniqueConstraints) lines.push(`  @@unique([${u.attributes.map((id) => fieldName(e.attributes.find((a) => a.id === id)!)).join(', ')}])`);
    for (const i of model.indexes.filter((x) => x.entity === e.id)) {
      const f = i.attributes.map((id) => fieldName(e.attributes.find((a) => a.id === id)!)).join(', ');
      lines.push(`  ${i.unique ? '@@unique' : '@@index'}([${f}]${i.name ? `, map: "${i.name}"` : ''})`);
      if (i.where) report.unsupported.push(`Índice parcial em ${e.name} não é expresso no schema Prisma (use migration SQL).`);
    }
    if (e.checks.length || e.attributes.some((a) => a.allowedValues?.length || (a.enumRef && !useEnums)))
      report.unsupported.push(`${e.name}: CHECK constraints não são expressos no Prisma; inclua-as na migration SQL gerada pelo alvo "sql".`);
    const table = physicalTable(model, e);
    if (table !== names.get(e.id)) lines.push(`  @@map("${table}")`);
    out.push(`model ${names.get(e.id)} {`, ...lines, '}', '');
  }
  return { schema: out.join('\n').trimEnd() + '\n', report };
}

export const prismaGenerator: Generator = {
  id: 'prisma',
  description: 'schema.prisma com relações, tipos nativos, índices e mapeamento de nomes.',
  dialects: ['postgresql', 'mysql', 'sqlserver', 'sqlite'],
  generate(input: GeneratorInput) {
    const { schema, report } = generatePrisma(input.model, input.dialect);
    return { files: [{ path: 'prisma/schema.prisma', content: schema, kind: 'schema' }], report };
  },
};
export type { Entity, Relationship };
