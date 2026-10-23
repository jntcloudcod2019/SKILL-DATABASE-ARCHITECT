import type { Analyzer, Evidence, Facts, FactColumn, FactRelation, FactTable, ScannedFile, Technology, DomainType } from '@dbarchitect/core';
import { emptyFacts } from '@dbarchitect/core';
import { expandOwned, findOwned, jsonColumnFor, type ClassRef } from './owned.ts';
import { CS_TYPES, classes, entityEnum, ev, props, propertyCfg, snake, type ClassInfo, type Prop } from './cs-parse.ts';


/** Detects .NET projects, EF Core, Dapper and database providers from project files. */
export const dotnetDetector: Analyzer = {
  id: 'dotnet-detector',
  category: 'detector',
  accepts: (p) => /\.(csproj|sln)$/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    const tech = (t: Technology) => { if (!facts.technologies.some((x) => x.name === t.name && x.kind === t.kind)) facts.technologies.push(t); };
    for (const f of files) {
      if (f.path.endsWith('.sln')) { tech({ kind: 'framework', name: '.NET solution', evidence: [{ source: 'code', file: f.path }] }); continue; }
      const e = (re: RegExp): Evidence[] => { const m = re.exec(f.content); return m ? [ev(f.path, f.content, m.index)] : []; };
      tech({ kind: 'language', name: 'C#', evidence: [{ source: 'code', file: f.path }] });
      const tfm = /<TargetFramework>([^<]+)</.exec(f.content);
      if (tfm) tech({ kind: 'framework', name: '.NET', version: tfm[1], evidence: e(/<TargetFramework>/) });
      for (const [re, name, kind] of [
        [/Microsoft\.EntityFrameworkCore(?!\.)/i, 'Entity Framework Core', 'orm'],
        [/Dapper/i, 'Dapper', 'orm'],
        [/Npgsql/i, 'PostgreSQL', 'database'],
        [/Microsoft\.EntityFrameworkCore\.SqlServer|System\.Data\.SqlClient|Microsoft\.Data\.SqlClient/i, 'SQL Server', 'database'],
        [/Microsoft\.EntityFrameworkCore\.Sqlite|Microsoft\.Data\.Sqlite/i, 'SQLite', 'database'],
        [/Pomelo|MySql/i, 'MySQL', 'database'],
        [/Microsoft\.AspNetCore|Sdk="Microsoft\.NET\.Sdk\.Web"/i, 'ASP.NET Core', 'framework'],
      ] as const) {
        const m = re.exec(f.content);
        if (m) tech({ kind, name, evidence: [ev(f.path, f.content, m.index)] });
      }
    }
    return facts;
  },
};


/**
 * EF Core interpreter: DbSet<T> entities, data annotations and Fluent API (in DbContext or IEntityTypeConfiguration).
 * Limits: no semantic evaluation — conditional configuration, loops and helper extension methods are not followed.
 */
export const efCoreAnalyzer: Analyzer = {
  id: 'efcore',
  category: 'orm',
  accepts: (p) => /\.cs$/i.test(p) && !/\/Migrations\/|\.Designer\.cs$/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    const allFiles = files;
    const allClasses = files.flatMap((f) => classes(f).map((c) => ({ c, f })));
    const dbSets = new Map<string, { table: string; ev: Evidence }>();
    let hasContext = false;
    for (const { c, f } of allClasses) {
      if (!/:\s*(?:\w+\.)?(?:Identity)?DbContext\b/.test(f.content.slice(c.start, c.start + c.name.length + 200))) continue;
      hasContext = true;
      for (const m of c.body.matchAll(/DbSet<(\w+)>\s+(\w+)/g))
        dbSets.set(m[1], { table: m[2], ev: ev(f.path, f.content, c.start + c.body.indexOf(m[0]), 'code', m[0]) });
    }
    if (!hasContext && !allClasses.some(({ c }) => /\[Table\(/.test(c.body))) {
      const hasCfg = allClasses.some(({ f }) => /IEntityTypeConfiguration</.test(f.content));
      if (!hasCfg) return facts;
    }
    facts.technologies.push({ kind: 'orm', name: 'Entity Framework Core', evidence: [{ source: 'code' }] });
    // Fluent API: collect per-entity statements from OnModelCreating and IEntityTypeConfiguration<T>.
    const fluent = new Map<string, string[]>();
    const add = (t: string, s: string) => fluent.set(t, [...(fluent.get(t) ?? []), s]);
    for (const f of files) {
      for (const m of f.content.matchAll(/IEntityTypeConfiguration<(\w+)>/g)) {
        const cfg = classes(f).find((c) => c.body.includes('Configure('));
        if (cfg) add(m[1], cfg.body);
      }
      for (const m of f.content.matchAll(/modelBuilder\s*\.\s*Entity<(\w+)>\s*\(\s*(?:\w+|\([^)]*\))\s*=>\s*\{/g)) {
        let depth = 1, i = m.index + m[0].length;
        while (i < f.content.length && depth) { const ch = f.content[i++]; if (ch === '{') depth++; else if (ch === '}') depth--; }
        add(m[1], f.content.slice(m.index + m[0].length, i - 1));
      }
      for (const m of f.content.matchAll(/modelBuilder\s*\.\s*Entity<(\w+)>\s*\(\s*\)((?:\s*\.[^;]+)+);/g)) add(m[1], 'e' + m[2]);
    }
    const entityNames = new Set<string>(dbSets.keys());
    for (const { c } of allClasses) if (/\[Table\(/.test(c.body.slice(0, 0)) || fluent.has(c.name)) entityNames.add(c.name);
    for (const { c, f } of allClasses) {
      const head = f.content.slice(Math.max(0, c.start - 200), c.start);
      if (/\[Table\(/.test(head)) entityNames.add(c.name);
    }
    const tables = new Map<string, FactTable>();
    const usedEntities = new Set<string>(entityNames);
    for (const name of entityNames) {
      const found = allClasses.find(({ c }) => c.name === name);
      if (!found) { facts.unparsed.push({ file: '(DbSet)', reason: `Classe ${name} referenciada em DbSet<> não encontrada nos arquivos analisados.` }); continue; }
      const { c, f } = found;
      const head = f.content.slice(Math.max(0, c.start - 300), c.start);
      const tableAttr = /\[Table\("([^"]+)"/.exec(head)?.[1];
      const cfg = (fluent.get(name) ?? []).join('\n');
      const toTable = /\.ToTable\("([^"]+)"/.exec(cfg)?.[1];
      const table = toTable ?? tableAttr ?? dbSets.get(name)?.table ?? name;
      const columns: FactColumn[] = [];
      const ps = props(c, f);
      const navTypes = new Set(ps.filter((p) => p.collection).map((p) => p.collection!));
      const keyProps = new Set<string>();
      const hasKeyCfg = /\.HasKey\(/.exec(cfg);
      if (hasKeyCfg) for (const k of cfg.slice(hasKeyCfg.index).split(')')[0].matchAll(/\b\w+\.(\w+)/g)) keyProps.add(k[1]);
      const tbEvidence = dbSets.get(name)?.ev ?? ev(f.path, f.content, c.start);
      // Owned / complex types and JSON columns are NOT relations: expand them into columns (or their own table) instead.
      const classRefs: ClassRef[] = allClasses;
      const ownedSpecs = findOwned(cfg, ps, classRefs);
      const ownedNavs = new Set(ownedSpecs.map((o) => o.nav));
      const jsonProps = new Set<string>();
      for (const p of ps) {
        if (p.attrs.some((a) => /^NotMapped/.test(a)) || ownedNavs.has(p.name)) continue;
        const jc = jsonColumnFor(p, propertyCfg(cfg, p.name), classRefs, f);
        if (jc) { jsonProps.add(p.name); columns.push(jc); continue; }
        const isScalar = CS_TYPES[p.type.toLowerCase()] !== undefined || entityEnum(p.type, allClasses.map((x) => x.f));
        if (p.collection || !isScalar) continue; // navigation, handled via relations
        const propCfg = propertyCfg(cfg, p.name);
        const col: FactColumn = {
          name: /Column\("([^"]+)"/.exec(p.attrs.join(' '))?.[1] ?? /HasColumnName\("([^"]+)"/.exec(propCfg)?.[1] ?? snake(p.name),
          property: p.name,
          type: p.type,
          domainType: CS_TYPES[p.type.toLowerCase()] ?? 'enum',
          nullable: p.nullable && !(p.attrs.some((a) => /^Required/.test(a)) || /IsRequired\(\s*(true)?\s*\)/.test(propCfg)),
          evidence: [{ source: 'code', file: f.path, line: p.line, excerpt: `${p.type}${p.nullable ? '?' : ''} ${p.name}` }],
        };
        // Assumption: nullable reference types are enabled (default in current templates), so `string` without `?` is NOT NULL.
        const max = /(?:MaxLength|StringLength)\((\d+)/.exec(p.attrs.join(' '))?.[1] ?? /HasMaxLength\((\d+)\)/.exec(propCfg)?.[1];
        if (max) col.length = Number(max);
        const prec = /HasPrecision\((\d+)(?:\s*,\s*(\d+))?\)/.exec(propCfg);
        if (prec) { col.precision = Number(prec[1]); if (prec[2]) col.scale = Number(prec[2]); }
        const pc = /Precision\((\d+)(?:\s*,\s*(\d+))?\)/.exec(p.attrs.join(' '));
        if (pc) { col.precision = Number(pc[1]); if (pc[2]) col.scale = Number(pc[2]); }
        const hasPkAttr = p.attrs.some((a) => /^Key\b/.test(a));
        if (hasPkAttr || keyProps.has(p.name) || (!hasKeyCfg && (p.name === 'Id' || p.name === `${name}Id`) && !ps.some((q) => q.attrs.some((a) => /^Key\b/.test(a))))) {
          col.primaryKey = true; col.nullable = false;
          if (!hasKeyCfg && !hasPkAttr) col.evidence.push({ source: 'code', note: 'Chave primária por convenção do EF Core (Id / <Entidade>Id).' });
        }
        if (/ValueGeneratedOnAdd|UseIdentityColumn|UseSerialColumn/.test(propCfg) || p.attrs.some((a) => /DatabaseGenerated\(.*Identity/.test(a))) col.generated = 'identity';
        const def = /HasDefaultValue(?:Sql)?\(([^)]*)\)/.exec(propCfg);
        if (def) col.default = def[1].replace(/^"|"$/g, '');
        if (col.domainType === 'enum') {
          col.enumRef = p.type;
          if (!facts.enums.some((x) => x.name === p.type)) {
            const ef = allFiles.find((x) => new RegExp(`enum\\s+${p.type}\\b`).test(x.content));
            const em = ef && new RegExp(`enum\\s+${p.type}\\s*(?::\\s*\\w+\\s*)?\\{([^}]*)\\}`).exec(ef.content);
            if (em) facts.enums.push({ name: p.type, values: em[1].split(',').map((v) => v.trim().replace(/\s*=.*$/, '')).filter(Boolean), evidence: [{ source: 'code', file: ef.path }] });
          }
          if (!/HasConversion<string>/.test(propCfg)) facts.limitations.push(`${name}.${p.name}: enum armazenado como inteiro por padrão no EF Core (sem HasConversion<string>); o modelo registra o domínio, confirme a representação física.`);
        }
        columns.push(col);
      }
      const ownedTables: FactTable[] = [];
      if (ownedSpecs.length) {
        const ownerPk = columns.find((x) => x.primaryKey);
        for (const spec of ownedSpecs) {
          const r = expandOwned(spec, { ownerName: name, ownerTable: table, ownerPk, file: f, classes: classRefs, files: allFiles, usedEntityNames: usedEntities }, [spec.nav]);
          columns.push(...r.columns); ownedTables.push(...r.tables); facts.relations.push(...r.relations); facts.limitations.push(...r.notes);
        }
        facts.limitations.push('Tipos owned/complex/JSON (EF Core): nomes físicos seguem as convenções do EF Core (Navegação_Propriedade; tabela = navegação) quando não há HasColumnName/ToTable; confirme contra a migration ou o banco. Mapeamentos por string/typeof e OwnsMany aninhado em tipo owned não são seguidos.');
      }
      const indexes: FactTable['indexes'] = [];
      for (const m of cfg.matchAll(/HasIndex\(\s*\w+\s*=>\s*(new\s*\{([^}]+)\}|\w+\.(\w+))\s*\)([^;]*);/g)) {
        const cols = m[2] ? [...m[2].matchAll(/\w+\.(\w+)/g)].map((x) => x[1]) : [m[3]];
        indexes.push({ columns: cols, unique: /IsUnique/.test(m[4]), name: /HasDatabaseName\("([^"]+)"/.exec(m[4])?.[1] });
      }
      for (const p of ps) if (p.attrs.some((a) => /^Index\b/.test(a))) indexes.push({ columns: [p.name], unique: false });
      for (const m of head.matchAll(/\[Index\(([^\]]+)\)\]/g)) {
        const cols = [...m[1].matchAll(/nameof\(\w+\.(\w+)\)|"(\w+)"/g)].map((x) => x[1] ?? x[2]);
        if (cols.length) indexes.push({ columns: cols, unique: /IsUnique\s*=\s*true/.test(m[1]) });
      }
      // map property names to column names for indexes
      for (const ix of indexes) ix.columns = ix.columns.map((p) => columns.find((cc) => cc.property === p)?.name ?? p);
      const t: FactTable = { name: table, entityName: name, source: f.path, columns, indexes, evidence: [tbEvidence] };
      tables.set(name, t);
      for (const ot of ownedTables) tables.set(`${name}.${ot.entityName}`, ot);
      // relations: reference navigation + FK property
      for (const p of ps) {
        if (ownedNavs.has(p.name) || jsonProps.has(p.name)) continue;
        if (p.collection || CS_TYPES[p.type.toLowerCase()] || !allClasses.some((x) => x.c.name === p.type)) continue;
        const target = p.type;
        const fkProp = /\[ForeignKey\("(\w+)"\)\]/.exec(p.attrs.map((a) => `[${a}]`).join(''))?.[1]
          ?? ps.find((q) => q.name === `${p.name}Id`)?.name
          ?? (/HasOne\(\s*\w+\s*=>\s*\w+\.${p.name}\b[\s\S]*?HasForeignKey(?:<\w+>)?\(\s*\w+\s*=>\s*(?:\w+\.(\w+)|new\s*\{([^}]+)\})/.exec(cfg)?.[1]);
        const cfgFk = new RegExp(`HasOne\\(\\s*\\w+\\s*=>\\s*\\w+\\.${p.name}\\b[\\s\\S]*?HasForeignKey(?:<\\w+>)?\\(\\s*\\w+\\s*=>\\s*(?:\\w+\\.(\\w+)|new\\s*\\{([^}]+)\\})`).exec(cfg);
        const fkProps = cfgFk ? (cfgFk[1] ? [cfgFk[1]] : [...cfgFk[2].matchAll(/\w+\.(\w+)/g)].map((x) => x[1])) : fkProp ? [fkProp] : [];
        if (!fkProps.length) { facts.unparsed.push({ file: f.path, reason: `Navegação ${name}.${p.name} sem chave estrangeira identificável (shadow property?).` }); continue; }
        const del = new RegExp(`HasOne\\(\\s*\\w+\\s*=>\\s*\\w+\\.${p.name}\\b[\\s\\S]*?OnDelete\\(DeleteBehavior\\.(\\w+)\\)`).exec(cfg)?.[1];
        const oneToOne = new RegExp(`HasOne\\(\\s*\\w+\\s*=>\\s*\\w+\\.${p.name}\\b[\\s\\S]*?WithOne`).test(cfg);
        facts.relations.push({
          fromTable: table, fromColumns: fkProps.map((x) => columns.find((cc) => cc.property === x)?.name ?? x), toTable: target, toColumns: [],
          cardinality: oneToOne ? '1:1' : 'N:1',
          onDelete: del ? ({ Cascade: 'cascade', Restrict: 'restrict', SetNull: 'set-null', NoAction: 'no-action', ClientSetNull: 'set-null' } as const)[del] : undefined,
          source: f.path, evidence: [{ source: 'code', file: f.path, line: p.line, excerpt: `${target} ${p.name}` }],
        });
      }
      void navTypes;
    }
    // resolve target class names to table names
    for (const r of facts.relations) {
      const t = tables.get(r.toTable);
      if (t) { r.toTable = t.name; r.toColumns = t.columns.filter((c) => c.primaryKey).map((c) => c.name); }
    }
    facts.tables.push(...tables.values());
    if (hasContext) facts.limitations.push('EF Core: configuração condicional, métodos de extensão e convenções customizadas não são avaliados; shadow properties não são descobertas.');
    return facts;
  },
};

/** EF Core migrations (Migrations/*.cs): record names only; never interpreted as the source of truth. */
export const efMigrationsAnalyzer: Analyzer = {
  id: 'efcore-migrations',
  category: 'extractor',
  accepts: (p) => /\/Migrations\/\d{14}_\w+\.cs$/i.test(p) && !/\.Designer\.cs$/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      const name = /\/(\d{14}_\w+)\.cs$/.exec(f.path)![1];
      facts.migrations.push({ file: f.path, tool: 'ef-core', name });
      for (const m of f.content.matchAll(/migrationBuilder\.(DropTable|DropColumn|AlterColumn|RenameColumn|RenameTable)\(/g))
        facts.limitations.push(`Migration ${name} contém ${m[1]} (operação potencialmente destrutiva no histórico).`);
    }
    return facts;
  },
};

/** Dapper usage: inline SQL strings passed to Query/Execute. Detection only; SQL is parsed by the SQL analyzer when it is a DDL file. */
export const dapperAnalyzer: Analyzer = {
  id: 'dapper',
  category: 'extractor',
  accepts: (p) => /\.cs$/i.test(p),
  analyze(files) {
    const facts = emptyFacts();
    for (const f of files) {
      if (!/\bDapper\b/.test(f.content)) continue;
      facts.technologies.push({ kind: 'orm', name: 'Dapper', evidence: [{ source: 'code', file: f.path }] });
      for (const m of f.content.matchAll(/\.(?:Query|QueryAsync|QueryFirst\w*|QuerySingle\w*|Execute\w*)(?:<\w+>)?\(\s*(?:@?"([^"]+)"|"""([\s\S]*?)""")/g)) {
        const sql = (m[1] ?? m[2]).replace(/\s+/g, ' ').trim();
        const sel = /^SELECT\b.*?\bFROM\s+\[?"?(\w+)/i.exec(sql);
        if (!sel) continue;
        const where = /\bWHERE\s+(.+?)(?:\bORDER BY|\bGROUP BY|$)/i.exec(sql)?.[1] ?? '';
        const order = /\bORDER BY\s+(.+?)(?:\bOFFSET|\bLIMIT|$)/i.exec(sql)?.[1] ?? '';
        facts.queries.push({
          id: `q_${f.path}_${m.index}`.replace(/[^\w.:-]/g, '_'), name: `${sel[1]} (${f.path.split('/').pop()})`, table: sel[1],
          filters: [...where.matchAll(/\[?"?(\w+)"?\]?\s*(?:=|<|>|\bLIKE\b|\bIN\b)/gi)].map((x) => x[1]), orderBy: [...order.matchAll(/\[?"?(\w+)"?\]?/g)].map((x) => x[1]).filter((x) => !/^(ASC|DESC)$/i.test(x)),
          pagination: /OFFSET|LIMIT|FETCH/i.test(sql) ? 'offset' : 'none', sql,
          provenance: { origin: 'code', confidence: 'high', evidence: [ev(f.path, f.content, m.index, 'code', sql)] },
        });
      }
    }
    return facts;
  },
};

export const dotnetAnalyzers: Analyzer[] = [dotnetDetector, efCoreAnalyzer, efMigrationsAnalyzer, dapperAnalyzer];
export type { Facts, FactRelation };
