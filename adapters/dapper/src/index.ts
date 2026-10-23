import {
  findEntity, physicalColumn, physicalTable,
  type CanonicalModel, type GeneratedFile, type Generator, type GeneratorInput, type GeneratorReport,
} from '@dbarchitect/core';
import { className, csType, enumMember, enumTypeMap, isValueType, namespaceFor, plural, propName } from '@dbarchitect/adapter-dotnet';
import { dialects, generateDdl } from '@dbarchitect/adapter-sql';

/** C# verbatim string literal: SQL identifiers may contain double quotes (PostgreSQL/SQLite). */
const lit = (sql: string) => `@"${sql.replace(/"/g, '""')}"`;

export function generateDapper(model: CanonicalModel, dialectId: GeneratorInput['dialect'], options: Record<string, unknown> = {}): { files: GeneratedFile[]; report: GeneratorReport } {
  const d = dialects[dialectId];
  const ddl = generateDdl(model, d);
  const report: GeneratorReport = { notes: [...ddl.report.notes], warnings: [...ddl.report.warnings], unsupported: [...ddl.report.unsupported] };
  const ns = namespaceFor(model, options);
  const enumTypes = enumTypeMap(model);
  const entities = model.entities.filter((e) => e.persistence === 'persistent');
  const files: GeneratedFile[] = [{ path: `database/schema.${d.id}.sql`, kind: 'schema', content: ddl.sql }];
  const param = (n: string) => (d.id === 'sqlserver' || d.id === 'sqlite' || d.id === 'mysql' ? '@' : '@') + n;

  for (const en of model.enums)
    files.push({ path: `Data/Models/${enumTypes.get(en.id)}.cs`, kind: 'code', content: `namespace ${ns}.Data.Models;\n\npublic enum ${enumTypes.get(en.id)}\n{\n${en.values.map((v) => `    ${enumMember(v)},`).join('\n')}\n}\n` });

  for (const e of entities) {
    const c = className(e);
    const props = e.attributes.map((a) => {
      const t = csType(a, model, enumTypes);
      return `    public ${t} ${propName(a)} { get; set; }${!t.endsWith('?') && !isValueType(t) ? (t === 'byte[]' ? ' = [];' : ' = null!;') : ''}`;
    });
    files.push({ path: `Data/Models/${c}.cs`, kind: 'code', content: ['using System;', '', `namespace ${ns}.Data.Models;`, '', `public class ${c}`, '{', ...props, '}', ''].join('\n') });

    // Explicit column aliases make the SQL <-> POCO mapping visible and independent of Dapper's naming settings.
    const t = d.quote(physicalTable(model, e));
    const sel = e.attributes.map((a) => `${d.quote(physicalColumn(model, a))} AS ${propName(a)}`).join(', ');
    const pk = e.attributes.filter((a) => a.primaryKey);
    const where = pk.map((a) => `${d.quote(physicalColumn(model, a))} = ${param(propName(a))}`).join(' AND ');
    const insertable = e.attributes.filter((a) => a.generated !== 'identity');
    const upd = e.attributes.filter((a) => !a.primaryKey);
    const q: string[] = [
      `    public const string SelectAll = ${lit(`SELECT ${sel} FROM ${t}`)};`,
      ...(pk.length ? [`    public const string GetById = SelectAll + ${lit(` WHERE ${where}`)};`] : []),
      `    public const string Insert = ${lit(`INSERT INTO ${t} (${insertable.map((a) => d.quote(physicalColumn(model, a))).join(', ')}) VALUES (${insertable.map((a) => param(propName(a))).join(', ')})`)};`,
      ...(pk.length && upd.length ? [`    public const string Update = ${lit(`UPDATE ${t} SET ${upd.map((a) => `${d.quote(physicalColumn(model, a))} = ${param(propName(a))}`).join(', ')} WHERE ${where}`)};`] : []),
      ...(pk.length ? [`    public const string Delete = ${lit(`DELETE FROM ${t} WHERE ${where}`)};`] : []),
    ];
    // Foreign-key lookups: only where the model declares the relationship.
    const lookups: string[] = [];
    for (const r of model.relationships.filter((x) => x.from.entity === e.id && x.cardinality !== 'N:N' && x.from.attributes.length)) {
      const names = r.from.attributes.map((id) => e.attributes.find((a) => a.id === id)!);
      const m = `By${names.map(propName).join('And')}`;
      q.push(`    public const string Select${m} = SelectAll + ${lit(` WHERE ${names.map((a) => `${d.quote(physicalColumn(model, a))} = ${param(propName(a))}`).join(' AND ')}`)};`);
      const sig = names.map((a) => `${csType({ ...a, nullable: false }, model, enumTypes)} ${propName(a)[0].toLowerCase() + propName(a).slice(1)}`).join(', ');
      lookups.push(`    public Task<IEnumerable<${c}>> Get${m}Async(${sig}) =>\n        _db.QueryAsync<${c}>(${c}Sql.Select${m}, new { ${names.map((a) => `${propName(a)} = ${propName(a)[0].toLowerCase() + propName(a).slice(1)}`).join(', ')} });`);
    }
    for (const kq of model.queries.filter((x) => x.entity === e.id && x.filters.length)) {
      const fs = kq.filters.map((id) => e.attributes.find((a) => a.id === id)).filter((a) => !!a);
      const ord = kq.orderBy.map((id) => e.attributes.find((a) => a.id === id)).filter((a) => !!a);
      const nm = kq.name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
      const sql = `SelectAll + ${lit(` WHERE ${fs.map((a) => `${d.quote(physicalColumn(model, a))} = ${param(propName(a))}`).join(' AND ')}${ord.length ? ` ORDER BY ${ord.map((a) => d.quote(physicalColumn(model, a))).join(', ')}` : ''}`)}`;
      q.push(`    // Known query "${kq.name}" (${kq.frequency ?? 'frequency unknown'}); pagination: ${kq.pagination ?? 'unspecified'}`, `    public const string ${nm} = ${sql};`);
      if (kq.pagination && kq.pagination !== 'none') report.notes.push(`Consulta "${kq.name}": paginação ${kq.pagination} não é gerada automaticamente; adicione ${d.id === 'sqlserver' ? 'OFFSET/FETCH' : 'LIMIT/OFFSET'} ou keyset conforme o requisito.`);
    }
    files.push({ path: `Data/Sql/${c}Sql.cs`, kind: 'code', content: ['namespace ' + ns + '.Data.Sql;', '', `public static class ${c}Sql`, '{', ...q, '}', ''].join('\n') });

    const idSig = pk.map((a) => `${csType({ ...a, nullable: false }, model, enumTypes)} ${propName(a)[0].toLowerCase() + propName(a).slice(1)}`).join(', ');
    const idObj = pk.map((a) => `${propName(a)} = ${propName(a)[0].toLowerCase() + propName(a).slice(1)}`).join(', ');
    files.push({ path: `Data/Repositories/${c}Repository.cs`, kind: 'code', content: [
      'using System.Data;', 'using Dapper;', `using ${ns}.Data.Models;`, `using ${ns}.Data.Sql;`, '', `namespace ${ns}.Data.Repositories;`, '',
      `public class ${c}Repository`, '{', '    private readonly IDbConnection _db;', `    public ${c}Repository(IDbConnection db) => _db = db;`, '',
      `    public Task<IEnumerable<${c}>> GetAllAsync() => _db.QueryAsync<${c}>(${c}Sql.SelectAll);`,
      ...(pk.length ? [`    public Task<${c}?> GetByIdAsync(${idSig}) =>\n        _db.QuerySingleOrDefaultAsync<${c}>(${c}Sql.GetById, new { ${idObj} });`] : []),
      `    public Task<int> InsertAsync(${c} entity) => _db.ExecuteAsync(${c}Sql.Insert, entity);`,
      ...(pk.length && upd.length ? [`    public Task<int> UpdateAsync(${c} entity) => _db.ExecuteAsync(${c}Sql.Update, entity);`] : []),
      ...(pk.length ? [`    public Task<int> DeleteAsync(${idSig}) => _db.ExecuteAsync(${c}Sql.Delete, new { ${idObj} });`] : []),
      ...lookups, '}', '',
    ].join('\n') });
    if (e.attributes.some((a) => a.generated === 'identity')) report.notes.push(`${e.name}: coluna identity — Insert não envia o valor; para recuperar a chave gerada use a cláusula específica do dialeto (RETURNING / OUTPUT / SCOPE_IDENTITY).`);
    if (e.attributes.some((a) => a.generated === 'uuid') && d.id === 'sqlite') report.notes.push(`${e.name}: SQLite não gera UUID; informe o valor na aplicação.`);
  }
  void findEntity; void plural;
  report.notes.push('Dapper não gerencia migrations. Aplique database/schema.*.sql com sua ferramenta (DbUp, FluentMigrator, Flyway) após revisão; nada é aplicado automaticamente.');
  return { files, report };
}

export const dapperGenerator: Generator = {
  id: 'dapper',
  description: 'DDL SQL, modelos C#, constantes SQL com aliases explícitos e repositórios Dapper.',
  dialects: ['postgresql', 'sqlserver', 'sqlite', 'mysql'],
  generate: (input: GeneratorInput) => generateDapper(input.model, input.dialect, input.options),
};
