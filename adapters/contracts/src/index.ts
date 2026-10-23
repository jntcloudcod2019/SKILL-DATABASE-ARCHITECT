import { parse as parseYaml } from 'yaml';
import type { Analyzer, Contract, ContractField, DomainType, Evidence, FactColumn, FactRelation, FactTable, Facts, ReferentialAction } from '@dbarchitect/core';
import { emptyFacts } from '@dbarchitect/core';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

function parseDoc(path: string, content: string): unknown {
  return /\.ya?ml$/i.test(path) ? parseYaml(content) : JSON.parse(content);
}

function resolveRef(root: Json, ref: string): Json | undefined {
  if (!ref.startsWith('#/')) return undefined; // external refs are not followed
  let cur: unknown = root;
  for (const part of ref.slice(2).split('/')) cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
  return isObj(cur) ? cur : undefined;
}

function fieldsOf(schema: Json, root: Json, prefix = '', depth = 0, seen = new Set<unknown>()): ContractField[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const resolved = typeof schema.$ref === 'string' ? (resolveRef(root, schema.$ref) ?? schema) : schema;
  const parts = Array.isArray(resolved.allOf) ? (resolved.allOf as Json[]).map((s) => (typeof s.$ref === 'string' ? (resolveRef(root, s.$ref) ?? s) : s)) : [resolved];
  const props: Record<string, Json> = {};
  const required = new Set<string>();
  for (const p of parts) {
    if (isObj(p.properties)) Object.assign(props, p.properties);
    if (Array.isArray(p.required)) for (const r of p.required) required.add(String(r));
  }
  const out: ContractField[] = [];
  for (const [name, raw] of Object.entries(props)) {
    const s = typeof raw.$ref === 'string' ? (resolveRef(root, raw.$ref) ?? raw) : raw;
    const type = Array.isArray(s.type) ? String(s.type.find((t) => t !== 'null') ?? 'object') : String(s.type ?? (s.properties ? 'object' : 'unknown'));
    const path = prefix + name;
    out.push({
      path, type, ...(typeof s.format === 'string' ? { format: s.format } : {}),
      requiredInRequest: required.has(name), nullable: s.nullable === true || (Array.isArray(s.type) && s.type.includes('null')),
      ...(typeof s.description === 'string' ? { description: s.description } : {}),
    });
    if (type === 'object' && depth < 2 && s.properties) out.push(...fieldsOf(s, root, `${path}.`, depth + 1, seen));
    if (type === 'array' && isObj(s.items) && depth < 2) {
      const it = typeof s.items.$ref === 'string' ? (resolveRef(root, s.items.$ref) ?? s.items) : s.items;
      if (it.properties) out.push(...fieldsOf(it, root, `${path}[].`, depth + 1, seen));
    }
  }
  return out;
}

function collectRefs(node: unknown, acc: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, acc));
  else if (isObj(node)) for (const [k, v] of Object.entries(node)) k === '$ref' && typeof v === 'string' ? acc.add(v) : collectRefs(v, acc);
}

/** OpenAPI 3.x / Swagger 2 (json|yaml). Request vs response usage is derived from the operations that reference each schema. */
export const openApiAnalyzer: Analyzer = {
  id: 'openapi',
  category: 'contract',
  accepts: (p) => /\.(json|ya?ml)$/i.test(p) && !/package(-lock)?\.json$|tsconfig|appsettings|\.schema\.json$/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      if (!/openapi|swagger/.test(f.content.slice(0, 2000))) continue;
      let doc: unknown;
      try { doc = parseDoc(f.path, f.content); } catch (e) { facts.unparsed.push({ file: f.path, reason: `Não foi possível interpretar como OpenAPI: ${(e as Error).message}` }); continue; }
      if (!isObj(doc) || !(doc.openapi || doc.swagger)) continue;
      const system = isObj(doc.info) && typeof doc.info.title === 'string' ? doc.info.title : f.path;
      const schemas = isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : isObj(doc.definitions) ? doc.definitions : {};
      const used: Record<string, { request: boolean; response: boolean }> = {};
      const mark = (ref: string, key: 'request' | 'response') => { const n = ref.split('/').pop()!; (used[n] ??= { request: false, response: false })[key] = true; };
      const closure = (start: Set<string>) => {
        const all = new Set(start);
        const queue = [...start];
        while (queue.length) {
          const s = resolveRef(doc as Json, queue.pop()!);
          if (!s) continue;
          const inner = new Set<string>();
          collectRefs(s, inner);
          for (const r of inner) if (!all.has(r)) { all.add(r); queue.push(r); }
        }
        return all;
      };
      if (isObj(doc.paths)) {
        for (const item of Object.values(doc.paths)) {
          if (!isObj(item)) continue;
          for (const op of Object.values(item)) {
            if (!isObj(op)) continue;
            const rq = new Set<string>(); collectRefs(op.requestBody ?? (Array.isArray(op.parameters) ? op.parameters.filter((p) => isObj(p) && p.in === 'body') : undefined), rq);
            const rs = new Set<string>(); collectRefs(op.responses, rs);
            // only top-level body schemas are marked directly; nested schemas inherit through closure
            for (const r of closure(rq)) mark(r, 'request');
            for (const r of closure(rs)) mark(r, 'response');
          }
        }
      }
      for (const [name, raw] of Object.entries(schemas)) {
        if (!isObj(raw)) continue;
        const fields = fieldsOf(raw, doc as Json);
        if (!fields.length) continue;
        const u = used[name];
        const usage: Array<'request' | 'response'> = [];
        if (u?.request) usage.push('request');
        if (u?.response) usage.push('response');
        const required = new Set(Array.isArray(raw.required) ? raw.required.map(String) : []);
        const contractFields = fields.map((x) => ({
          ...x,
          requiredInRequest: u?.request ? x.requiredInRequest : undefined,
          requiredInResponse: u?.response ? !x.path.includes('.') && required.has(x.path) : undefined,
        }));
        facts.contracts.push({
          id: `oas_${system}_${name}`.replace(/[^\w.:-]/g, '_').slice(0, 110), name, system, kind: 'openapi',
          direction: u?.request && u?.response ? 'both' : u?.request ? 'inbound' : u?.response ? 'outbound' : 'both',
          ...(usage.length ? { usage } : {}), fields: contractFields.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as unknown as ContractField),
          provenance: { origin: 'document', confidence: 'confirmed', evidence: [{ source: 'document', file: f.path, note: `components.schemas.${name}` }], rationale: usage.length ? undefined : 'Schema não referenciado por nenhuma operação; direção desconhecida.' },
        });
      }
      facts.limitations.push(`OpenAPI ${f.path}: $ref externos, oneOf/anyOf e discriminadores não são expandidos; até 2 níveis de aninhamento.`);
    }
    return facts;
  },
};

export const jsonSchemaAnalyzer: Analyzer = {
  id: 'json-schema',
  category: 'contract',
  accepts: (p) => /\.schema\.json$/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      let doc: unknown;
      try { doc = JSON.parse(f.content); } catch (e) { facts.unparsed.push({ file: f.path, reason: `JSON Schema inválido: ${(e as Error).message}` }); continue; }
      if (!isObj(doc)) continue;
      const name = (typeof doc.title === 'string' && doc.title) || f.path.split('/').pop()!.replace(/\.schema\.json$/, '');
      const fields = fieldsOf(doc, doc);
      if (!fields.length) continue;
      facts.contracts.push({
        id: `js_${name}`.replace(/[^\w.:-]/g, '_'), name, system: 'json-schema', kind: 'json-schema', direction: 'both', fields,
        provenance: { origin: 'document', confidence: 'confirmed', evidence: [{ source: 'document', file: f.path }], rationale: 'JSON Schema não distingue requisição de resposta; "required" foi lido como obrigatório na requisição.' },
      });
    }
    return facts;
  },
};

const SQL_DOMAIN: Array<[RegExp, DomainType]> = [
  [/^(bigint|int8|bigserial)/i, 'bigint'], [/^(int|integer|smallint|int4|serial|tinyint\((?!1\))|mediumint)/i, 'integer'], [/^(numeric|decimal|money|smallmoney)/i, 'decimal'],
  [/^(float|double|real)/i, 'decimal'], [/^(bool|boolean|bit|tinyint\(1\))/i, 'boolean'], [/^(timestamp|datetime|datetimeoffset|datetime2|smalldatetime)/i, 'datetime'],
  [/^date\b/i, 'date'], [/^time/i, 'time'], [/^(uuid|uniqueidentifier)/i, 'uuid'], [/^(jsonb?)/i, 'json'], [/^(bytea|blob|varbinary|binary|longblob)/i, 'binary'],
  [/^(text|longtext|mediumtext|clob|ntext)/i, 'text'], [/^(n?varchar|n?char|character|string|citext)/i, 'string'],
];

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const unq = (s: string) => s.replace(/^[\["`]|[\]"`]$/g, '').replace(/^.*\./, '').replace(/[\["`\]]/g, '');
const cols = (s: string) => s.split(',').map((x) => unq(x.trim().split(/\s+/)[0]));
const ACT: Record<string, ReferentialAction> = { CASCADE: 'cascade', RESTRICT: 'restrict', 'SET NULL': 'set-null', 'NO ACTION': 'no-action', 'SET DEFAULT': 'set-default' };

/** SQL DDL: CREATE TABLE / CREATE INDEX / ALTER TABLE ADD FOREIGN KEY. Dialect-tolerant, not a full parser. */
export const sqlDdlAnalyzer: Analyzer = {
  id: 'sql-ddl',
  category: 'extractor',
  accepts: (p) => /\.sql$/i.test(p) && !/prisma\/migrations\//.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      const text = f.content.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const tables = new Map<string, FactTable>();
      for (const m of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."\[\]`]+)\s*\(([\s\S]*?)\)\s*(?:;|ENGINE|WITH|\n\s*GO|$)/gi)) {
        const name = unq(m[1]);
        const ev: Evidence = { source: 'code', file: f.path, line: text.slice(0, m.index).split('\n').length };
        const t: FactTable = { name, source: f.path, columns: [], indexes: [], evidence: [ev] };
        const pkCols: string[] = [];
        for (const raw of splitTop(m[2])) {
          const item = raw.trim().replace(/\s+/g, ' ');
          const pk = /^(?:CONSTRAINT [\w"`\[\]]+ )?PRIMARY KEY\s*\(([^)]+)\)/i.exec(item);
          const uq = /^(?:CONSTRAINT ([\w"`\[\]]+) )?UNIQUE(?: KEY| INDEX)?\s*(?:[\w"`]+\s*)?\(([^)]+)\)/i.exec(item);
          const fk = /^(?:CONSTRAINT [\w"`\[\]]+ )?FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+([\w."\[\]`]+)\s*\(([^)]+)\)(.*)$/i.exec(item);
          if (pk) { pkCols.push(...cols(pk[1])); continue; }
          if (uq) { t.indexes.push({ columns: cols(uq[2]), unique: true, name: uq[1] ? unq(uq[1]) : undefined }); continue; }
          if (fk) { facts.relations.push(mkRel(name, cols(fk[1]), unq(fk[2]), cols(fk[3]), fk[4], f.path, ev)); continue; }
          if (/^(CONSTRAINT|CHECK|INDEX|KEY|FULLTEXT)/i.test(item)) continue;
          const cm = /^([\w"`\[\]]+)\s+([A-Za-z_]+(?:\s*\([^)]*\))?(?:\[\])?)(.*)$/.exec(item);
          if (!cm) continue;
          const [, cn, type, rest] = cm;
          const dom = SQL_DOMAIN.find(([re]) => re.test(type))?.[1];
          const c: FactColumn = { name: unq(cn), type, domainType: dom ?? 'string', nullable: !/NOT NULL/i.test(rest) && !/PRIMARY KEY/i.test(rest), evidence: [ev] };
          const len = /\((\d+)\)/.exec(type); if (len && dom === 'string') c.length = Number(len[1]);
          const pr = /\((\d+)\s*,\s*(\d+)\)/.exec(type); if (pr) { c.precision = Number(pr[1]); c.scale = Number(pr[2]); }
          if (/PRIMARY KEY/i.test(rest)) pkCols.push(c.name);
          if (/\bUNIQUE\b/i.test(rest)) c.unique = true;
          if (/AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|SERIAL|GENERATED .* AS IDENTITY/i.test(rest + type)) c.generated = 'identity';
          const def = /DEFAULT\s+(\([^)]*\)|'[^']*'|[\w.]+(?:\(\))?)/i.exec(rest);
          if (def) c.default = def[1];
          const inl = /REFERENCES\s+([\w."\[\]`]+)\s*\(([^)]+)\)(.*)$/i.exec(rest);
          if (inl) facts.relations.push(mkRel(name, [c.name], unq(inl[1]), cols(inl[2]), inl[3], f.path, ev));
          t.columns.push(c);
        }
        for (const c of t.columns) if (pkCols.includes(c.name)) { c.primaryKey = true; c.nullable = false; }
        tables.set(name, t);
      }
      for (const m of text.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?([\w."\[\]`]+)\s+ADD\s+(?:CONSTRAINT\s+[\w"`\[\]]+\s+)?FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+([\w."\[\]`]+)\s*\(([^)]+)\)([^;]*)/gi))
        facts.relations.push(mkRel(unq(m[1]), cols(m[2]), unq(m[3]), cols(m[4]), m[5], f.path, { source: 'code', file: f.path, line: text.slice(0, m.index).split('\n').length }));
      for (const m of text.matchAll(/CREATE\s+(UNIQUE\s+)?(?:NONCLUSTERED\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"`\[\]]+)\s+ON\s+([\w."\[\]`]+)\s*(?:USING\s+\w+\s*)?\(([^)]+)\)/gi)) {
        const t = tables.get(unq(m[3]));
        if (t) t.indexes.push({ columns: cols(m[4]), unique: !!m[1], name: unq(m[2]) });
      }
      facts.tables.push(...tables.values());
      if (tables.size) facts.technologies.push({ kind: 'format', name: 'SQL DDL', evidence: [{ source: 'code', file: f.path }] });
    }
    return facts;
  },
};

function mkRel(from: string, fc: string[], to: string, tc: string[], tail: string, file: string, ev: Evidence): FactRelation {
  const del = /ON DELETE\s+(CASCADE|RESTRICT|SET NULL|NO ACTION|SET DEFAULT)/i.exec(tail)?.[1].toUpperCase();
  return { fromTable: from, fromColumns: fc, toTable: to, toColumns: tc, cardinality: 'N:1', onDelete: del ? ACT[del] : undefined, source: file, evidence: [ev] };
}

export const markdownAnalyzer: Analyzer = {
  id: 'markdown-docs',
  category: 'docs',
  accepts: (p) => /\.(md|markdown)$/i.test(p) && !/(^|\/)(node_modules|CHANGELOG)/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      const headings = [...f.content.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
      facts.documents.push({ file: f.path, title: headings[0] ?? f.path, headings });
    }
    return facts;
  },
};

/** Connection settings: reports which keys exist and the provider, never the value. */
export const connectionAnalyzer: Analyzer = {
  id: 'connection-config',
  category: 'config',
  accepts: (p) => /(^|\/)appsettings(\.\w+)?\.json$|(^|\/)(docker-compose|compose)\.ya?ml$|(^|\/)\.env\.(example|sample)$/i.test(p),
  analyze(files) {
    const facts: Facts = emptyFacts();
    for (const f of files) {
      for (const m of f.content.matchAll(/"(\w*ConnectionString\w*|DefaultConnection|\w+)"\s*:\s*"([^"]*(?:Server|Host|Data Source|Database|postgres|mysql|sqlserver|sqlite)[^"]*)"/gi)) {
        const v = m[2];
        const provider = /postgres|Host=|Npgsql/i.test(v) ? 'PostgreSQL' : /Server=.*;|sqlserver|Data Source=.*;/i.test(v) ? 'SQL Server' : /mysql/i.test(v) ? 'MySQL' : /sqlite|\.db/i.test(v) ? 'SQLite' : 'unknown';
        facts.connections.push({ file: f.path, provider, key: m[1] });
        facts.technologies.push({ kind: 'database', name: provider, evidence: [{ source: 'code', file: f.path, note: `chave "${m[1]}" (valor omitido)` }] });
      }
      for (const m of f.content.matchAll(/image:\s*['"]?(postgres|mysql|mariadb|mcr\.microsoft\.com\/mssql\/server)[:\w.-]*/gi))
        facts.technologies.push({ kind: 'database', name: /postgres/i.test(m[1]) ? 'PostgreSQL' : /mssql/i.test(m[1]) ? 'SQL Server' : 'MySQL', evidence: [{ source: 'code', file: f.path, note: 'imagem de container' }] });
    }
    return facts;
  },
};

export const contractAnalyzers: Analyzer[] = [openApiAnalyzer, jsonSchemaAnalyzer, sqlDdlAnalyzer, markdownAnalyzer, connectionAnalyzer];
export type { Contract };
