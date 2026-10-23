import type { DomainType, Evidence, FactColumn, FactRelation, FactTable, ScannedFile } from '@dbarchitect/core';
import { CS_TYPES, entityEnum, props, propertyCfg, type ClassInfo, type Prop } from './cs-parse.ts';

export interface ClassRef { c: ClassInfo; f: ScannedFile }

export interface OwnedSpec {
  nav: string;
  /** one = OwnsOne (table splitting), many = OwnsMany (own table), complex = ComplexProperty / [ComplexType] (table splitting). */
  kind: 'one' | 'many' | 'complex';
  typeName: string;
  /** Builder lambda body (inner OwnsOne/Property/ToTable/HasKey/ToJson calls). */
  body: string;
  json: boolean;
  jsonColumn?: string;
  optional: boolean;
  prop: Prop;
}

export interface OwnedCtx {
  ownerName: string;
  ownerTable: string;
  ownerPk?: FactColumn;
  file: ScannedFile;
  classes: ClassRef[];
  files: ScannedFile[];
  usedEntityNames: Set<string>;
}

export interface OwnedResult { columns: FactColumn[]; tables: FactTable[]; relations: FactRelation[]; notes: string[] }

const JSON_TYPES = new Set(['JsonDocument', 'JsonElement', 'JsonNode', 'JsonObject', 'JsonArray']);
const lastSegment = (t: string) => t.replace(/<.*$/, '').split('.').pop() ?? t;

/** Text between a '(' (at `open`) and its matching ')', and the index after it. Skips string literals. */
function balanced(text: string, open: number): { inner: string; end: number } | undefined {
  let depth = 0, inStr = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return undefined;
}

function splitFirstArg(args: string): [string, string] {
  let depth = 0, inStr = false;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) return [args.slice(0, i), args.slice(i + 1)];
  }
  return [args, ''];
}

const classHead = (r: ClassRef) => r.f.content.slice(Math.max(0, r.c.start - 300), r.c.start);
const findClass = (classes: ClassRef[], name: string) => classes.find((x) => x.c.name === lastSegment(name));

/** Owned / complex navigations of one type, from fluent calls in `cfg` and from [Owned]/[ComplexType] on the target class. */
export function findOwned(cfg: string, ps: Prop[], classes: ClassRef[]): OwnedSpec[] {
  const out: OwnedSpec[] = [];
  for (const m of cfg.matchAll(/\.(OwnsOne|OwnsMany|ComplexProperty)(?:<[^>]+>)?\s*\(/g)) {
    const call = balanced(cfg, m.index + m[0].length - 1);
    if (!call) continue;
    const [first, builder] = splitFirstArg(call.inner);
    const nav = /^\s*(?:\w+|\(\w+\))\s*=>\s*\w+\.(\w+)\s*$/.exec(first)?.[1];
    if (!nav) continue; // string-based or typeof() forms are not followed
    const prop = ps.find((p) => p.name === nav);
    if (!prop) continue;
    const chain = cfg.slice(call.end, call.end + 400).split(';')[0];
    const scope = `${builder}\n${chain}`;
    const tj = /\.?ToJson\(\s*(?:"([^"]+)")?\s*\)/.exec(scope);
    out.push({
      nav, kind: m[1] === 'OwnsOne' ? 'one' : m[1] === 'OwnsMany' ? 'many' : 'complex', typeName: lastSegment(prop.collection ?? prop.type),
      body: builder, json: !!tj, jsonColumn: tj?.[1], optional: prop.nullable, prop,
    });
  }
  for (const p of ps) {
    if (out.some((o) => o.nav === p.name) || p.attrs.some((a) => /^NotMapped/.test(a))) continue;
    const cls = findClass(classes, p.collection ?? p.type);
    if (!cls || CS_TYPES[p.type.toLowerCase()]) continue;
    const head = classHead(cls);
    const owned = /\[Owned\b/.test(head), complex = /\[ComplexType\b/.test(head);
    if (!owned && !complex) continue;
    out.push({ nav: p.name, kind: p.collection ? 'many' : complex ? 'complex' : 'one', typeName: cls.c.name, body: '', json: false, optional: p.nullable, prop: p });
  }
  return out;
}

/** Inner shape of a type as readable text, e.g. "Rua:string, Numero:int, Contato{Telefone:string}". */
export function shapeOf(typeName: string, classes: ClassRef[], depth = 0): string {
  const cls = findClass(classes, typeName);
  if (!cls) return typeName;
  return props(cls.c, cls.f).filter((p) => !p.attrs.some((a) => /^(NotMapped|JsonIgnore)/.test(a))).map((p) => {
    const inner = p.collection ?? p.type;
    const nested = !CS_TYPES[inner.toLowerCase()] && findClass(classes, inner);
    if (nested && depth < 2) return `${p.name}${p.collection ? '[]' : ''}{${shapeOf(inner, classes, depth + 1)}}`;
    return `${p.name}:${p.collection ? `${inner}[]` : p.type}${p.nullable ? '?' : ''}`;
  }).join(', ');
}

/** A property stored as a JSON column: JsonDocument/JsonNode types, HasColumnType("json[b]"), [Column(TypeName="jsonb")] or JsonSerializer conversion. */
export function jsonColumnFor(p: Prop, propCfg: string, classes: ClassRef[], file: ScannedFile): FactColumn | undefined {
  const attrs = p.attrs.join(' ');
  const typed = /HasColumnType\(\s*"(json|jsonb)"/i.exec(propCfg)?.[1] ?? /TypeName\s*=\s*"(json|jsonb)"/i.exec(attrs)?.[1];
  const byType = JSON_TYPES.has(lastSegment(p.type));
  const byConversion = /JsonSerializer|JsonConvert/.test(propCfg);
  if (!typed && !byType && !byConversion) return undefined;
  const element = p.collection ?? p.type;
  const shape = findClass(classes, element) ? shapeOf(element, classes) : '';
  const how = typed ? `tipo de coluna ${typed.toLowerCase()}` : byType ? `tipo ${lastSegment(p.type)}` : 'conversão por serialização JSON';
  return {
    name: /Column\("([^"]+)"/.exec(attrs)?.[1] ?? /HasColumnName\("([^"]+)"/.exec(propCfg)?.[1] ?? p.name,
    property: p.name, type: typed?.toLowerCase() ?? 'json', domainType: 'json',
    nullable: p.nullable && !(p.attrs.some((a) => /^Required/.test(a)) || /IsRequired\(\s*(true)?\s*\)/.test(propCfg)),
    description: `Coluna JSON (${how})${shape ? `${p.collection ? ' — lista de' : ' —'} {${shape}}` : ''}`,
    evidence: [{ source: 'code', file: file.path, line: p.line, excerpt: `${p.type}${p.nullable ? '?' : ''} ${p.name}`, note: `JSON: ${how}` }],
  };
}

function scalarKind(t: string, files: ScannedFile[]): DomainType | undefined {
  return CS_TYPES[t.toLowerCase()] ?? (entityEnum(t, files) ? 'enum' : undefined);
}

/** Columns for the scalar members of an owned type; nested owned types recurse (table splitting prefixes names as Nav_Sub_Prop). */
function ownedColumns(spec: OwnedSpec, typeName: string, body: string, prefix: string[], optional: boolean, ctx: OwnedCtx, depth: number, out: OwnedResult): FactColumn[] {
  const cls = findClass(ctx.classes, typeName);
  if (!cls) { out.notes.push(`Tipo owned ${typeName} (${ctx.ownerName}.${spec.nav}) não encontrado nos arquivos analisados.`); return []; }
  const ps = props(cls.c, cls.f);
  const nested = findOwned(body, ps, ctx.classes);
  const cols: FactColumn[] = [];
  for (const p of ps) {
    if (p.attrs.some((a) => /^NotMapped/.test(a))) continue;
    const pc = propertyCfg(body, p.name);
    const n = nested.find((x) => x.nav === p.name);
    const evd: Evidence = { source: 'code', file: cls.f.path, line: p.line, excerpt: `${p.type}${p.nullable ? '?' : ''} ${p.name}`, note: `Membro do tipo owned ${typeName} (${ctx.ownerName}.${[...prefix, ].join('.') || spec.nav})` };
    if (n) {
      const sub = expandOwned({ ...n, optional: optional || n.optional }, { ...ctx, ownerName: ctx.ownerName }, [...prefix, n.nav], depth + 1);
      cols.push(...sub.columns); out.tables.push(...sub.tables); out.relations.push(...sub.relations); out.notes.push(...sub.notes);
      continue;
    }
    const jc = jsonColumnFor(p, pc, ctx.classes, cls.f);
    const dom = scalarKind(p.type, ctx.files);
    if (!jc && !dom) {
      if (findClass(ctx.classes, p.collection ?? p.type)) out.notes.push(`${ctx.ownerName}.${[...prefix, p.name].join('.')}: tipo aninhado ${p.collection ?? p.type} dentro de ${typeName} sem configuração owned/JSON reconhecida; não mapeado.`);
      continue;
    }
    const explicit = /HasColumnName\("([^"]+)"/.exec(pc)?.[1] ?? /Column\("([^"]+)"/.exec(p.attrs.join(' '))?.[1];
    const base: FactColumn = jc ?? {
      name: '', property: p.name, type: p.type, domainType: dom!, nullable: p.nullable && !(p.attrs.some((a) => /^Required/.test(a)) || /IsRequired\(\s*(true)?\s*\)/.test(pc)),
      evidence: [evd],
    };
    base.name = explicit ?? (prefix.length ? [...prefix, p.name].join('_') : p.name);
    base.property = [...prefix, p.name].join('.');
    // A column of an optional owned navigation must be nullable: the dependent may be absent.
    if (optional) base.nullable = true;
    const max = /(?:MaxLength|StringLength)\((\d+)/.exec(p.attrs.join(' '))?.[1] ?? /HasMaxLength\((\d+)\)/.exec(pc)?.[1];
    if (max) base.length = Number(max);
    const prec = /HasPrecision\((\d+)(?:\s*,\s*(\d+))?\)/.exec(pc) ?? /Precision\((\d+)(?:\s*,\s*(\d+))?\)/.exec(p.attrs.join(' '));
    if (prec) { base.precision = Number(prec[1]); if (prec[2]) base.scale = Number(prec[2]); }
    if (base.domainType === 'enum') base.enumRef = p.type;
    if (!explicit) base.evidence.push({ source: 'code', note: 'Nome físico pela convenção do EF Core (Navegação_Propriedade); confirme contra a migration/banco.' });
    cols.push(base);
  }
  return cols;
}

/** Expands one owned/complex navigation into columns (table splitting / JSON) or its own table (OwnsMany). */
export function expandOwned(spec: OwnedSpec, ctx: OwnedCtx, prefix: string[] = [spec.nav], depth = 0): OwnedResult {
  const out: OwnedResult = { columns: [], tables: [], relations: [], notes: [] };
  const ev0: Evidence = { source: 'code', file: ctx.file.path, line: spec.prop.line, excerpt: `${spec.prop.collection ? `${spec.prop.collection}[]` : spec.prop.type} ${spec.nav}` };
  if (depth > 2) { out.notes.push(`${ctx.ownerName}.${spec.nav}: aninhamento owned acima de 3 níveis não expandido.`); return out; }

  if (spec.json) {
    const shape = shapeOf(spec.typeName, ctx.classes);
    out.columns.push({
      name: spec.jsonColumn ?? /HasColumnName\("([^"]+)"/.exec(spec.body)?.[1] ?? prefix.join('_'), property: prefix.join('.'), type: 'json', domainType: 'json', nullable: spec.optional || spec.kind === 'many',
      description: `Coluna JSON (ToJson) — ${spec.kind === 'many' ? 'lista de ' : ''}{${shape}}`,
      evidence: [{ ...ev0, note: `${spec.kind === 'many' ? 'OwnsMany' : 'OwnsOne'} mapeado como JSON (ToJson); os membros ficam dentro da coluna, não são colunas separadas.` }],
    });
    return out;
  }

  if (spec.kind === 'many') {
    if (depth > 0) { out.notes.push(`${ctx.ownerName}.${prefix.join('.')}: OwnsMany aninhado em tipo owned não expandido.`); return out; }
    const tableName = /\.ToTable\(\s*"([^"]+)"/.exec(spec.body)?.[1] ?? spec.nav;
    const fkMatch = /HasForeignKey\(\s*(?:"(\w+)"|\w+\s*=>\s*\w+\.(\w+))/.exec(spec.body);
    const fkName = fkMatch ? (fkMatch[1] ?? fkMatch[2]) : `${ctx.ownerName}Id`;
    const keyNames = /HasKey\(([^)]*)\)/.exec(spec.body)?.[1];
    const keys = keyNames ? [...keyNames.matchAll(/"(\w+)"|\.(\w+)/g)].map((x) => x[1] ?? x[2]) : [];
    const cols: FactColumn[] = [];
    const conv = 'Chave/FK pela convenção do EF Core para tipo owned (OwnsMany): tabela própria, FK para o dono com cascade.';
    if (!keys.length) cols.push({ name: 'Id', property: 'Id', type: 'int', domainType: 'integer', nullable: false, primaryKey: true, generated: 'identity', evidence: [{ ...ev0, note: 'Chave sombra "Id" (identity) criada por convenção para coleção owned.' }] });
    cols.push({ name: fkName, property: fkName, type: ctx.ownerPk?.type ?? 'int', domainType: ctx.ownerPk?.domainType ?? 'integer', nullable: false, primaryKey: keys.includes(fkName), evidence: [{ ...ev0, note: conv }] });
    const members = ownedColumns(spec, spec.typeName, spec.body, [], false, ctx, depth, out);
    for (const c of members) if (keys.includes(c.property ?? c.name)) { c.primaryKey = true; c.nullable = false; }
    cols.push(...members);
    let entityName = spec.typeName;
    if (ctx.usedEntityNames.has(entityName)) entityName = `${ctx.ownerName}${spec.nav}`;
    ctx.usedEntityNames.add(entityName);
    out.tables.push({ name: tableName, entityName, source: ctx.file.path, columns: cols, indexes: [], evidence: [{ ...ev0, note: `Coleção owned ${spec.nav} do tipo ${spec.typeName}${/ToTable/.test(spec.body) ? '' : ' (tabela nomeada pela navegação, convenção do EF Core)'}` }] });
    out.relations.push({ fromTable: tableName, fromColumns: [fkName], toTable: ctx.ownerTable, toColumns: ctx.ownerPk ? [ctx.ownerPk.name] : [], cardinality: 'N:1', onDelete: 'cascade', source: ctx.file.path, evidence: [{ ...ev0, note: conv }] });
    return out;
  }

  out.columns.push(...ownedColumns(spec, spec.typeName, spec.body, prefix, spec.optional, ctx, depth, out));
  return out;
}
