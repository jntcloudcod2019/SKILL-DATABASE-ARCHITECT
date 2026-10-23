import type { Analyzer, DomainType, Evidence, FactColumn, FactRelation, FactTable, ReferentialAction } from '@dbarchitect/core';
import { emptyFacts } from '@dbarchitect/core';

const lineOf = (s: string, idx: number) => s.slice(0, idx).split('\n').length;

/** package.json: language, frameworks, ORMs and database drivers. Dependency lists only — no scripts are run. */
export const nodeDetector: Analyzer = {
  id: 'node-detector',
  category: 'detector',
  accepts: (p) => /(^|\/)package\.json$/.test(p) || /(^|\/)tsconfig\.json$/.test(p),
  analyze(files) {
    const facts = emptyFacts();
    const seen = new Set<string>();
    const tech = (kind: 'language' | 'framework' | 'orm' | 'database', name: string, file: string, version?: string) => {
      if (seen.has(kind + name)) return;
      seen.add(kind + name);
      facts.technologies.push({ kind, name, ...(version ? { version } : {}), evidence: [{ source: 'code', file }] });
    };
    for (const f of files) {
      if (f.path.endsWith('tsconfig.json')) { tech('language', 'TypeScript', f.path); continue; }
      let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      try { pkg = JSON.parse(f.content); } catch { facts.unparsed.push({ file: f.path, reason: 'package.json inválido' }); continue; }
      const deps = { ...pkg.devDependencies, ...pkg.dependencies };
      tech('language', deps.typescript ? 'TypeScript' : 'JavaScript', f.path);
      const map: Array<[string, 'framework' | 'orm' | 'database', string]> = [
        ['express', 'framework', 'Express'], ['@nestjs/core', 'framework', 'NestJS'], ['fastify', 'framework', 'Fastify'], ['next', 'framework', 'Next.js'],
        ['prisma', 'orm', 'Prisma'], ['@prisma/client', 'orm', 'Prisma'], ['typeorm', 'orm', 'TypeORM'], ['sequelize', 'orm', 'Sequelize'], ['drizzle-orm', 'orm', 'Drizzle'], ['knex', 'orm', 'Knex'], ['mongoose', 'orm', 'Mongoose'],
        ['pg', 'database', 'PostgreSQL'], ['mysql2', 'database', 'MySQL'], ['mssql', 'database', 'SQL Server'], ['better-sqlite3', 'database', 'SQLite'], ['sqlite3', 'database', 'SQLite'],
      ];
      for (const [dep, kind, name] of map) if (deps[dep]) tech(kind, name, f.path, deps[dep]);
      for (const orm of ['typeorm', 'sequelize', 'drizzle-orm', 'knex', 'mongoose'])
        if (deps[orm]) facts.limitations.push(`${orm}: detectado, mas a extração de entidades não é implementada neste MVP (somente Prisma e EF Core têm extração estrutural). Os modelos desse ORM devem ser descritos pela IA/usuário.`);
    }
    return facts;
  },
};

const PRISMA_SCALAR: Record<string, DomainType> = { String: 'string', Int: 'integer', BigInt: 'bigint', Float: 'decimal', Decimal: 'decimal', Boolean: 'boolean', DateTime: 'datetime', Json: 'json', Bytes: 'binary' };
const ACTIONS: Record<string, ReferentialAction> = { Cascade: 'cascade', Restrict: 'restrict', SetNull: 'set-null', NoAction: 'no-action', SetDefault: 'set-default' };

/** Prisma schema parser (models, enums, @id/@unique/@default/@relation/@@index/@@map). */
export const prismaAnalyzer: Analyzer = {
  id: 'prisma',
  category: 'orm',
  accepts: (p) => /\.prisma$/.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      const text = f.content;
      const provider = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/.exec(text)?.[1];
      facts.technologies.push({ kind: 'orm', name: 'Prisma', evidence: [{ source: 'code', file: f.path }] });
      if (provider) facts.technologies.push({ kind: 'database', name: { postgresql: 'PostgreSQL', mysql: 'MySQL', sqlserver: 'SQL Server', sqlite: 'SQLite' }[provider] ?? provider, evidence: [{ source: 'code', file: f.path, excerpt: `provider = "${provider}"` }] });
      const enums = new Set<string>();
      for (const m of text.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
        enums.add(m[1]);
        facts.enums.push({ name: m[1], values: m[2].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((x) => x && !x.startsWith('//') && !x.startsWith('@')), evidence: [{ source: 'code', file: f.path, line: lineOf(text, m.index) }] });
      }
      const models = [...text.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)];
      const modelNames = new Set(models.map((m) => m[1]));
      const tableOf = new Map<string, string>();
      const colOf = new Map<string, Map<string, string>>();
      for (const m of models) {
        const t = /@@map\("([^"]+)"\)/.exec(m[2])?.[1] ?? m[1];
        tableOf.set(m[1], t);
        const cm = new Map<string, string>();
        for (const l of m[2].split('\n')) {
          const fm = /^\s*(\w+)\s+/.exec(l);
          if (fm) cm.set(fm[1], /@map\("([^"]+)"\)/.exec(l)?.[1] ?? fm[1]);
        }
        colOf.set(m[1], cm);
      }
      for (const m of models) {
        const body = m[2];
        const base = m.index + m[0].indexOf('{');
        const cols: FactColumn[] = [];
        const compositePk = /@@id\(\[([^\]]+)\]/.exec(body)?.[1].split(',').map((x) => x.trim()) ?? [];
        const indexes: FactTable['indexes'] = [];
        const tbl = tableOf.get(m[1])!;
        const cmap = colOf.get(m[1])!;
        for (const im of body.matchAll(/@@(index|unique)\(\[([^\]]+)\]([^)]*)\)/g))
          indexes.push({ columns: im[2].split(',').map((x) => cmap.get(x.trim().replace(/\(.*$/, '')) ?? x.trim()), unique: im[1] === 'unique', name: /map:\s*"([^"]+)"/.exec(im[3])?.[1] });
        body.split('\n').forEach((line, li) => {
          const fm = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
          if (!fm || line.trim().startsWith('//') || line.trim().startsWith('@@')) return;
          const [, name, type, list, opt, rest] = fm;
          const evidence: Evidence = { source: 'code', file: f.path, line: lineOf(text, base) + li, excerpt: line.trim() };
          if (modelNames.has(type)) {
            const rel = /@relation\(([^)]*)\)/.exec(rest);
            if (rel && /fields:/.test(rel[1]) && !list) {
              const fields = /fields:\s*\[([^\]]+)\]/.exec(rel[1])![1].split(',').map((x) => x.trim());
              const refs = /references:\s*\[([^\]]+)\]/.exec(rel[1])?.[1].split(',').map((x) => x.trim()) ?? [];
              const del = /onDelete:\s*(\w+)/.exec(rel[1])?.[1];
              const toCols = colOf.get(type)!;
              const r: FactRelation = {
                fromTable: tbl, fromColumns: fields.map((x) => cmap.get(x) ?? x), toTable: tableOf.get(type)!, toColumns: refs.map((x) => toCols.get(x) ?? x),
                cardinality: 'N:1', onDelete: del ? ACTIONS[del] : undefined, source: f.path, evidence: [evidence],
              };
              facts.relations.push(r);
            }
            return;
          }
          const isEnum = enums.has(type);
          const dom = PRISMA_SCALAR[type];
          if (!dom && !isEnum) { facts.unparsed.push({ file: f.path, reason: `Tipo Prisma desconhecido: ${type} em ${m[1]}.${name}` }); return; }
          if (list) { facts.limitations.push(`${m[1]}.${name}: lista escalar (${type}[]) não mapeada para coluna.`); return; }
          const col: FactColumn = { name: cmap.get(name) ?? name, property: name, type, domainType: isEnum ? 'enum' : dom, nullable: !!opt, evidence: [evidence] };
          if (/@id\b/.test(rest) || compositePk.includes(name)) { col.primaryKey = true; col.nullable = false; }
          if (/@unique\b/.test(rest)) col.unique = true;
          if (isEnum) col.enumRef = type;
          const def = /@default\(([^)]*(?:\([^)]*\))?[^)]*)\)/.exec(rest)?.[1];
          if (def) {
            if (/autoincrement/.test(def)) col.generated = 'identity';
            else if (/uuid|cuid/.test(def)) col.generated = 'uuid';
            else if (/now\(\)/.test(def)) col.generated = 'now';
            else col.default = def.replace(/^"|"$/g, '');
          }
          const db = /@db\.(\w+)\(([^)]*)\)/.exec(rest);
          if (db) {
            const nums = db[2].split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
            if (/VarChar|Char/i.test(db[1]) && nums[0]) col.length = nums[0];
            if (/Decimal/i.test(db[1])) { col.precision = nums[0]; col.scale = nums[1]; }
          }
          cols.push(col);
        });
        facts.tables.push({ name: tbl, entityName: m[1], source: f.path, columns: cols, indexes, evidence: [{ source: 'code', file: f.path, line: lineOf(text, m.index) }] });
      }
      // 1:1 when the FK columns are unique
      for (const r of facts.relations) {
        const t = facts.tables.find((x) => x.name === r.fromTable);
        if (!t || r.fromColumns.length === 0) continue;
        const cs = r.fromColumns.map((c) => t.columns.find((x) => x.name === c));
        if ((r.fromColumns.length === 1 && cs[0]?.unique) || t.indexes.some((i) => i.unique && i.columns.length === r.fromColumns.length && i.columns.every((c) => r.fromColumns.includes(c)))) r.cardinality = '1:1';
      }
    }
    return facts;
  },
};

export const prismaMigrationsAnalyzer: Analyzer = {
  id: 'prisma-migrations',
  category: 'extractor',
  accepts: (p) => /prisma\/migrations\/[^/]+\/migration\.sql$/.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      const name = f.path.split('/').slice(-2)[0];
      facts.migrations.push({ file: f.path, tool: 'prisma', name });
      for (const m of f.content.matchAll(/\b(DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+COLUMN)\b/gi)) facts.limitations.push(`Migration ${name} contém ${m[1].toUpperCase()} (histórico destrutivo).`);
    }
    return facts;
  },
};

/** Exported TypeScript interfaces/types in files that look like DTO/contract definitions. Structural only. */
export const tsContractAnalyzer: Analyzer = {
  id: 'ts-contracts',
  category: 'contract',
  accepts: (p) => /\.(ts)$/.test(p) && !/\.(test|spec)\.ts$|\.d\.ts$/.test(p) && /(dto|contract|schema|types?|model|interface|payload|request|response)/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      for (const m of f.content.matchAll(/export\s+(?:interface|type)\s+(\w*(?:Dto|DTO|Request|Response|Payload|Input|Output|Contract)\w*)\s*(?:=\s*)?\{([^}]*)\}/g)) {
        const fields = [...m[2].matchAll(/^\s*(?:readonly\s+)?(\w+)(\?)?\s*:\s*([^;\n]+)/gm)].map((x) => ({
          path: x[1], type: x[3].trim().replace(/\s*\|\s*null$/, ''), nullable: /\|\s*null/.test(x[3]), requiredInRequest: !x[2],
        }));
        if (!fields.length) continue;
        const dir = /response|output/i.test(m[1]) ? 'outbound' : /request|input|payload/i.test(m[1]) ? 'inbound' : 'both';
        facts.contracts.push({
          id: `dto_${m[1]}`, name: m[1], system: 'internal', kind: 'dto', direction: dir,
          usage: /response|output/i.test(m[1]) ? ['response'] : /request|input|payload/i.test(m[1]) ? ['request'] : undefined,
          fields, provenance: { origin: 'code', confidence: 'medium', evidence: [{ source: 'code', file: f.path, line: lineOf(f.content, m.index) }], rationale: 'Opcional (?) em TypeScript foi lido como não obrigatório na requisição; isso NÃO implica nulabilidade de coluna.' },
        });
      }
    }
    if (facts.contracts.length) facts.limitations.push('Contratos TypeScript: apenas interfaces/types de objeto simples exportados; tipos genéricos, intersecções e classes com decorators não são lidos.');
    return facts;
  },
};

export const nodeAnalyzers: Analyzer[] = [nodeDetector, prismaAnalyzer, prismaMigrationsAnalyzer, tsContractAnalyzer];
