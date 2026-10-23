import {
  applyNaming, slug, uniqueId,
  type Attribute, type CanonicalModel, type Entity, type Evidence, type Facts, type Index, type Question, type Relationship,
} from '@dbarchitect/core';

const codeProv = (evidence: Evidence[], rationale?: string) => ({ origin: 'code' as const, confidence: 'confirmed' as const, evidence, ...(rationale ? { rationale } : {}) });

function singularName(s: string): string {
  const w = applyNaming(s, 'PascalCase');
  return w;
}

/**
 * Turns structural facts into model elements. Everything here is evidence-backed (origin "code");
 * semantics (domain rules, optionality, intent) are NOT inferred and are left for the AI/user to add as separate, labelled elements.
 */
export function factsToModel(model: CanonicalModel, facts: Facts): CanonicalModel {
  const m = structuredClone(model);
  m.project.languages = [...new Set([...m.project.languages, ...facts.technologies.filter((t) => t.kind === 'language').map((t) => t.name)])];
  m.project.frameworks = [...new Set([...m.project.frameworks, ...facts.technologies.filter((t) => t.kind === 'framework').map((t) => t.name)])];
  const orms = [...new Set(facts.technologies.filter((t) => t.kind === 'orm').map((t) => t.name))];
  const dbs = [...new Set(facts.technologies.filter((t) => t.kind === 'database').map((t) => t.name))];
  if (orms.length) m.project.orm = orms.join(', ');
  if (dbs.length) m.project.database = dbs.join(', ');

  const enumByName = new Map<string, string>();
  for (const en of facts.enums) {
    const id = uniqueId(`enum_${slug(en.name)}`, m.enums.map((x) => x.id));
    enumByName.set(en.name, id);
    m.enums.push({ id, name: en.name, values: en.values, provenance: codeProv(en.evidence) });
  }

  // Group same-named tables coming from different sources to detect conflicts.
  const byTable = new Map<string, typeof facts.tables>();
  for (const t of facts.tables) byTable.set(t.name.toLowerCase(), [...(byTable.get(t.name.toLowerCase()) ?? []), t]);

  const tableToEntity = new Map<string, Entity>();
  for (const [key, group] of byTable) {
    const t = group[0];
    const id = uniqueId(slug(t.entityName ?? t.name), m.entities.map((e) => e.id));
    const usedAttr = new Set<string>();
    const attributes: Attribute[] = t.columns.map((c) => {
      const aid = uniqueId(slug(c.name), usedAttr);
      usedAttr.add(aid);
      return {
        id: aid,
        // Owned members carry dotted property paths (Endereco.Local.Latitude); domain names must be plain identifiers.
        name: (c.property ?? c.name).replace(/\./g, '_'),
        column: c.name,
        domainType: c.domainType ?? 'string',
        nullable: c.nullable,
        // Optionality in the domain is a business fact we cannot read from code: assume it mirrors the column but say so.
        domainOptional: c.nullable,
        ...(c.primaryKey ? { primaryKey: true } : {}),
        ...(c.unique ? { unique: true } : {}),
        ...(c.description ? { description: c.description } : {}),
        ...(c.length ? { length: c.length } : {}),
        ...(c.precision ? { precision: c.precision } : {}),
        ...(c.scale !== undefined ? { scale: c.scale } : {}),
        ...(c.generated ? { generated: c.generated } : {}),
        ...(c.default ? { default: { kind: 'literal' as const, value: c.default } } : {}),
        ...(c.enumRef && enumByName.has(c.enumRef) ? { enumRef: enumByName.get(c.enumRef) } : {}),
        provenance: codeProv(c.evidence, 'Extraído do código; opcionalidade de domínio assumida igual à nulabilidade da coluna até confirmação.'),
      };
    });
    const uniques: Entity['uniqueConstraints'] = [];
    for (const ix of t.indexes.filter((i) => i.unique)) {
      const attrs = ix.columns.map((c) => attributes.find((a) => a.column === c)?.id).filter((x): x is string => !!x);
      if (attrs.length === 1) {
        const a = attributes.find((x) => x.id === attrs[0])!;
        a.unique = true;
      } else if (attrs.length > 1) uniques.push({ id: `uq_${attrs.join('_')}`, ...(ix.name ? { name: ix.name } : {}), attributes: attrs });
    }
    const e: Entity = {
      id, name: singularName(t.entityName ?? t.name), table: t.name, kind: 'entity', persistence: 'persistent',
      attributes, uniqueConstraints: uniques, checks: [], provenance: codeProv(t.evidence),
    };
    m.entities.push(e);
    tableToEntity.set(key, e);
    if (t.entityName) tableToEntity.set(t.entityName.toLowerCase(), e);
    for (const ix of t.indexes.filter((i) => !i.unique)) {
      const attrs = ix.columns.map((c) => attributes.find((a) => a.column === c)?.id).filter((x): x is string => !!x);
      if (attrs.length === ix.columns.length) {
        const index: Index = { id: uniqueId(`ix_${id}_${attrs.join('_')}`, m.indexes.map((i) => i.id)), entity: id, ...(ix.name ? { name: ix.name } : {}), attributes: attrs, unique: false, provenance: codeProv(t.evidence) };
        m.indexes.push(index);
      }
    }
    // Conflict detection between different sources describing the same table.
    if (group.length > 1) {
      const diffs: string[] = [];
      const ref = new Map(t.columns.map((c) => [c.name.toLowerCase(), c]));
      for (const other of group.slice(1)) {
        for (const c of other.columns) {
          const r = ref.get(c.name.toLowerCase());
          if (!r) diffs.push(`coluna ${c.name} só existe em ${other.source}`);
          else if (r.nullable !== c.nullable) diffs.push(`coluna ${c.name}: nulabilidade difere (${t.source}: ${r.nullable ? 'NULL' : 'NOT NULL'} vs ${other.source}: ${c.nullable ? 'NULL' : 'NOT NULL'})`);
        }
        for (const c of t.columns) if (!other.columns.some((o) => o.name.toLowerCase() === c.name.toLowerCase())) diffs.push(`coluna ${c.name} ausente em ${other.source}`);
      }
      if (diffs.length) {
        const q: Question = {
          id: uniqueId(`q_conflict_${id}`, m.questions.map((x) => x.id)), impact: 'critical', status: 'open',
          text: `Fontes divergem sobre a tabela ${t.name}: ${diffs.slice(0, 4).join('; ')}. Qual representa o estado desejado?`,
          options: group.map((g) => g.source), relatedTo: [id],
          conflicts: group.flatMap((g) => g.evidence),
          consequences: 'Gerar sem resolver propagaria uma das versões silenciosamente.',
          provenance: { origin: 'code', confidence: 'high' },
        };
        m.questions.push(q);
      }
    }
  }

  const resolve = (name: string) => tableToEntity.get(name.toLowerCase());
  for (const r of facts.relations) {
    const from = resolve(r.fromTable);
    const to = resolve(r.toTable);
    if (!from || !to) {
      m.questions.push({ id: uniqueId(`q_unresolved_${slug(r.fromTable)}_${slug(r.toTable)}`, m.questions.map((x) => x.id)), text: `Relacionamento ${r.fromTable} → ${r.toTable} encontrado no código, mas uma das tabelas não foi extraída.`, impact: 'high', status: 'open', provenance: { origin: 'code', evidence: r.evidence } });
      continue;
    }
    const fa = r.fromColumns.map((c) => from.attributes.find((a) => a.column?.toLowerCase() === c.toLowerCase() || a.name.toLowerCase() === c.toLowerCase())?.id).filter((x): x is string => !!x);
    const ta = (r.toColumns.length ? r.toColumns : to.attributes.filter((a) => a.primaryKey).map((a) => a.column ?? a.name)).map((c) => to.attributes.find((a) => a.column?.toLowerCase() === c.toLowerCase() || a.name.toLowerCase() === c.toLowerCase())?.id).filter((x): x is string => !!x);
    const nullableFk = fa.some((id) => from.attributes.find((a) => a.id === id)?.nullable);
    const rel: Relationship = {
      id: uniqueId(`rel_${from.id}_${fa.join('_') || to.id}`, m.relationships.map((x) => x.id)), from: { entity: from.id, attributes: fa }, to: { entity: to.id, attributes: ta },
      cardinality: r.cardinality, required: !nullableFk, onDelete: r.onDelete ?? 'no-action', provenance: codeProv(r.evidence, r.onDelete ? undefined : 'Comportamento de exclusão não declarado no código; NO ACTION é o padrão dos bancos.'),
    };
    m.relationships.push(rel);
  }

  for (const c of facts.contracts) if (!m.contracts.some((x) => x.id === c.id)) m.contracts.push(c);

  for (const q of facts.queries) {
    const e = resolve(q.table);
    if (!e) continue;
    const toId = (n: string) => e.attributes.find((a) => a.column?.toLowerCase() === n.toLowerCase() || a.name.toLowerCase() === n.toLowerCase())?.id;
    m.queries.push({ ...q, entity: e.id, filters: q.filters.map(toId).filter((x): x is string => !!x), orderBy: q.orderBy.map(toId).filter((x): x is string => !!x) } as never);
  }
  for (const k of ['table', 'entity'] as const) void k;
  m.queries = m.queries.map((q) => { const { table: _t, ...rest } = q as typeof q & { table?: string }; return rest; });
  return m;
}
