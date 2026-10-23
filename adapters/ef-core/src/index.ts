import {
  findEntity, physicalColumn, physicalTable,
  type Attribute, type CanonicalModel, type Entity, type GeneratedFile, type Generator, type GeneratorInput, type GeneratorReport,
} from '@dbarchitect/core';
import { camel, className, csType, enumMember, enumTypeMap, isValueType, namespaceFor, plural, propName } from '@dbarchitect/adapter-dotnet';

const DELETE: Record<string, string> = { cascade: 'Cascade', restrict: 'Restrict', 'set-null': 'SetNull', 'no-action': 'NoAction', 'set-default': 'ClientSetNull' };
const PROVIDER: Record<string, string> = { postgresql: 'Npgsql.EntityFrameworkCore.PostgreSQL', sqlserver: 'Microsoft.EntityFrameworkCore.SqlServer', sqlite: 'Microsoft.EntityFrameworkCore.Sqlite', mysql: 'Pomelo.EntityFrameworkCore.MySql' };

interface Nav { entity: string; name: string; type: string; collection: boolean; }

export function generateEfCore(model: CanonicalModel, dialect: string, options: Record<string, unknown> = {}): { files: GeneratedFile[]; report: GeneratorReport } {
  const report: GeneratorReport = { notes: [], warnings: [], unsupported: [] };
  const ns = namespaceFor(model, options);
  const enumTypes = enumTypeMap(model);
  const entities = model.entities.filter((e) => e.persistence === 'persistent');
  const ids = new Set(entities.map((e) => e.id));
  const nav = new Map<string, Nav[]>(entities.map((e) => [e.id, []]));
  const used = new Map(entities.map((e) => [e.id, new Set(e.attributes.map(propName))]));
  const uniq = (eid: string, base: string) => { const s = used.get(eid)!; let n = base, i = 2; while (s.has(n)) n = base + i++; s.add(n); return n; };
  const rels = model.relationships.filter((r) => r.cardinality !== 'N:N' && ids.has(r.from.entity) && ids.has(r.to.entity) && r.from.attributes.length);
  const relNav = new Map<string, { fwd: string; back: string }>();
  for (const r of rels) {
    const from = findEntity(model, r.from.entity)!;
    const to = findEntity(model, r.to.entity)!;
    const optional = r.from.attributes.some((id) => from.attributes.find((a) => a.id === id)?.nullable);
    const fwd = uniq(from.id, className(to));
    const back = uniq(to.id, r.cardinality === '1:1' ? className(from) : plural(className(from)));
    nav.get(from.id)!.push({ entity: to.id, name: fwd, type: `${className(to)}${optional ? '?' : ''}`, collection: false });
    nav.get(to.id)!.push({ entity: from.id, name: back, type: r.cardinality === '1:1' ? `${className(from)}?` : `ICollection<${className(from)}>`, collection: r.cardinality !== '1:1' });
    relNav.set(r.id, { fwd, back });
  }

  const files: GeneratedFile[] = [];
  for (const en of model.enums) {
    const n = enumTypes.get(en.id)!;
    files.push({ path: `Domain/Enums/${n}.cs`, kind: 'code', content: `namespace ${ns}.Domain.Enums;\n\npublic enum ${n}\n{\n${en.values.map((v) => `    ${enumMember(v)},`).join('\n')}\n}\n` });
  }

  for (const e of entities) {
    const lines: string[] = [];
    for (const a of e.attributes) {
      const t = csType(a, model, enumTypes);
      const needsInit = !t.endsWith('?') && !isValueType(t) && t !== 'byte[]';
      lines.push(`    public ${t} ${propName(a)} { get; set; }${needsInit ? ' = null!;' : t === 'byte[]' ? ' = [];' : ''}`);
    }
    for (const n of nav.get(e.id)!) lines.push(`    public ${n.type} ${n.name} { get; set; }${n.collection ? ' = new List<' + n.type.slice(12, -1) + '>();' : n.type.endsWith('?') ? '' : ' = null!;'}`);
    const doc = e.description ?? e.responsibility;
    files.push({ path: `Domain/Entities/${className(e)}.cs`, kind: 'code', content: `${[
      'using System;', 'using System.Collections.Generic;', `using ${ns}.Domain.Enums;`, '', `namespace ${ns}.Domain.Entities;`, '',
      ...(doc ? ['/// <summary>', ...doc.split('\n').map((l) => `/// ${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`), '/// </summary>'] : []),
      `public class ${className(e)}`, '{', ...lines, '}',
    ].join('\n')}\n` });
  }

  // Fluent API configurations
  for (const e of entities) {
    const c = className(e);
    const b: string[] = [];
    b.push(`        builder.ToTable("${physicalTable(model, e)}"${e.checks.length || e.attributes.some((a) => a.allowedValues?.length) ? ', t =>\n        {\n' + [
      ...e.checks.map((k) => `            t.HasCheckConstraint("${k.name ?? 'ck_' + k.id}", "${k.expression.replace(/"/g, '\\"')}");`),
      ...e.attributes.filter((a) => a.allowedValues?.length).map((a) => `            t.HasCheckConstraint("ck_${physicalTable(model, e)}_${physicalColumn(model, a)}", "${physicalColumn(model, a)} IN (${a.allowedValues!.map((v) => `'${v}'`).join(', ')})");`),
    ].join('\n') + '\n        }' : ''});`);
    const pks = e.attributes.filter((a) => a.primaryKey);
    if (pks.length) b.push(`        builder.HasKey(${pks.length === 1 ? `e => e.${propName(pks[0])}` : `e => new { ${pks.map((a) => 'e.' + propName(a)).join(', ')} }`});`);
    else b.push('        builder.HasNoKey();');
    for (const a of e.attributes) {
      const chain = [`.HasColumnName("${physicalColumn(model, a)}")`];
      if (!a.nullable || a.primaryKey) chain.push('.IsRequired()');
      if (a.length && a.domainType === 'string') chain.push(`.HasMaxLength(${a.length})`);
      if ((a.domainType === 'decimal' || a.domainType === 'money') && (a.precision || a.domainType === 'money')) chain.push(`.HasPrecision(${a.precision ?? 18}, ${a.scale ?? 2})`);
      if (a.physicalType) chain.push(`.HasColumnType("${a.physicalType}")`);
      else if (a.domainType === 'json') chain.push(dialect === 'postgresql' ? '.HasColumnType("jsonb")' : dialect === 'mysql' ? '.HasColumnType("json")' : '.HasColumnType("nvarchar(max)")');
      if (a.domainType === 'enum' && a.enumRef) chain.push(`.HasConversion<string>().HasMaxLength(${Math.max(50, ...(model.enums.find((x) => x.id === a.enumRef)?.values.map((v) => v.length) ?? [0]))})`);
      if (a.generated === 'identity') chain.push('.ValueGeneratedOnAdd()');
      else if (a.generated === 'uuid') chain.push(dialect === 'postgresql' ? '.HasDefaultValueSql("gen_random_uuid()")' : dialect === 'sqlserver' ? '.HasDefaultValueSql("NEWID()")' : '.ValueGeneratedOnAdd()');
      else if (a.generated === 'now') chain.push(`.HasDefaultValueSql("${dialect === 'sqlserver' ? 'SYSDATETIMEOFFSET()' : dialect === 'postgresql' ? 'now()' : 'CURRENT_TIMESTAMP'}")`);
      else if (a.generated === 'none' || !a.generated) {
        if (pks.length === 1 && a.primaryKey && a.generated !== 'none') {/* convention */}
        if (a.primaryKey && !a.generated) chain.push('.ValueGeneratedNever()');
        if (a.default) chain.push(a.default.kind === 'expression' ? `.HasDefaultValueSql("${a.default.value.replace(/"/g, '\\"')}")` : `.HasDefaultValue(${csLiteral(a, a.default.value)})`);
      }
      b.push(`        builder.Property(e => e.${propName(a)})\n            ${chain.join('\n            ')};`);
    }
    for (const a of e.attributes.filter((x) => x.unique && !x.primaryKey)) b.push(`        builder.HasIndex(e => e.${propName(a)}).IsUnique();`);
    for (const u of e.uniqueConstraints) b.push(`        builder.HasIndex(e => ${u.attributes.length === 1 ? 'e.' + propName(e.attributes.find((a) => a.id === u.attributes[0])!) : 'new { ' + u.attributes.map((id) => 'e.' + propName(e.attributes.find((a) => a.id === id)!)).join(', ') + ' }'})${u.name ? `.HasDatabaseName("${u.name}")` : ''}.IsUnique();`);
    for (const i of model.indexes.filter((x) => x.entity === e.id)) {
      const props = i.attributes.map((id) => 'e.' + propName(e.attributes.find((a) => a.id === id)!));
      b.push(`        builder.HasIndex(e => ${props.length === 1 ? props[0] : 'new { ' + props.join(', ') + ' }'})${i.name ? `.HasDatabaseName("${i.name}")` : ''}${i.unique ? '.IsUnique()' : ''}${i.where ? `.HasFilter("${i.where.replace(/"/g, '\\"')}")` : ''};`);
    }
    for (const r of rels.filter((x) => x.from.entity === e.id)) {
      const to = findEntity(model, r.to.entity)!;
      const names = relNav.get(r.id)!;
      const fks = r.from.attributes.map((id) => 'e.' + propName(e.attributes.find((a) => a.id === id)!));
      const optional = r.from.attributes.some((id) => e.attributes.find((a) => a.id === id)?.nullable);
      const toKeys = r.to.attributes.length ? r.to.attributes.map((id) => 'e.' + propName(to.attributes.find((a) => a.id === id)!)) : [];
      b.push(`        builder.HasOne(e => e.${names.fwd})\n            ${r.cardinality === '1:1' ? `.WithOne(p => p.${names.back})\n            .HasForeignKey<${c}>(e => ${fks.length === 1 ? fks[0] : 'new { ' + fks.join(', ') + ' }'})` : `.WithMany(p => p.${names.back})\n            .HasForeignKey(e => ${fks.length === 1 ? fks[0] : 'new { ' + fks.join(', ') + ' }'})`}${toKeys.length && !to.attributes.filter((a) => a.primaryKey).every((p) => r.to.attributes.includes(p.id)) ? `\n            .HasPrincipalKey(${r.cardinality === '1:1' ? '' : ''}e => ${toKeys.length === 1 ? toKeys[0] : 'new { ' + toKeys.join(', ') + ' }'})` : ''}\n            .IsRequired(${optional ? 'false' : 'true'})\n            .OnDelete(DeleteBehavior.${DELETE[r.onDelete]});`);
      if (r.onDelete === 'set-default') report.warnings.push(`${r.name ?? r.id}: SET DEFAULT não é suportado pelo EF Core; usando ClientSetNull.`);
    }
    files.push({ path: `Infrastructure/Persistence/Configurations/${c}Configuration.cs`, kind: 'code', content: [
      'using Microsoft.EntityFrameworkCore;', 'using Microsoft.EntityFrameworkCore.Metadata.Builders;', `using ${ns}.Domain.Entities;`, '',
      `namespace ${ns}.Infrastructure.Persistence.Configurations;`, '',
      `public class ${c}Configuration : IEntityTypeConfiguration<${c}>`, '{', `    public void Configure(EntityTypeBuilder<${c}> builder)`, '    {', ...b, '    }', '}', '',
    ].join('\n') });
  }

  files.push({ path: 'Infrastructure/Persistence/AppDbContext.cs', kind: 'code', content: [
    'using Microsoft.EntityFrameworkCore;', `using ${ns}.Domain.Entities;`, '', `namespace ${ns}.Infrastructure.Persistence;`, '',
    'public class AppDbContext : DbContext', '{', '    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }', '',
    ...entities.map((e) => `    public DbSet<${className(e)}> ${plural(className(e))} => Set<${className(e)}>();`), '',
    '    protected override void OnModelCreating(ModelBuilder modelBuilder)', '    {', '        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);', '    }', '}', '',
  ].join('\n') });

  if (options.csproj !== false) {
    files.push({ path: `${ns}.csproj`, kind: 'config', content: [
      '<Project Sdk="Microsoft.NET.Sdk">', '  <PropertyGroup>', '    <TargetFramework>net8.0</TargetFramework>', '    <Nullable>enable</Nullable>', '    <ImplicitUsings>enable</ImplicitUsings>', `    <RootNamespace>${ns}</RootNamespace>`, '  </PropertyGroup>', '  <ItemGroup>',
      '    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="8.0.*" />', '    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="8.0.*" PrivateAssets="all" />',
      `    <PackageReference Include="${PROVIDER[dialect]}" Version="8.0.*" />`, '  </ItemGroup>', '</Project>', '',
    ].join('\n') });
    report.notes.push('Arquivo .csproj gerado apenas como ponto de partida; mescle manualmente se o projeto já possui um (use options.csproj=false para omitir).');
  }
  report.notes.push('Migrations NÃO são geradas por este alvo. Após revisar os arquivos, execute: dotnet ef migrations add <Nome> (ferramenta oficial) e revise o script antes de aplicar.');
  void camel;
  return { files, report };
}

function csLiteral(a: Attribute, v: string): string {
  if (['integer', 'bigint'].includes(a.domainType)) return v;
  if (['decimal', 'money'].includes(a.domainType)) return `${v}m`;
  if (a.domainType === 'boolean') return /^(true|1)$/i.test(v) ? 'true' : 'false';
  return `"${v.replace(/"/g, '\\"')}"`;
}

export const efCoreGenerator: Generator = {
  id: 'ef-core',
  description: 'Entidades C#, configurações Fluent API (IEntityTypeConfiguration), DbContext e enums para EF Core 8.',
  dialects: ['postgresql', 'sqlserver', 'sqlite', 'mysql'],
  generate: (input: GeneratorInput) => generateEfCore(input.model, input.dialect, input.options),
};
export type { Entity };
