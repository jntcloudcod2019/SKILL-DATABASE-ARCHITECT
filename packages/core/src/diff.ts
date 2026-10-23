import type { Attribute, CanonicalModel, Entity } from './types.ts';
import { canonicalJson, physicalColumn, physicalTable } from './model.ts';

export type Risk = 'safe' | 'risky' | 'destructive';

export interface Change {
  kind: 'added' | 'removed' | 'modified';
  element: string;
  id: string;
  entity?: string;
  description: string;
  risk: Risk;
  reason?: string;
}

const TYPE_WIDTH: Record<string, number> = { integer: 1, bigint: 2, decimal: 3, money: 3 };

function attrChanges(model: CanonicalModel, e: Entity, a: Attribute, b: Attribute): Change[] {
  const out: Change[] = [];
  const base = { element: 'attribute', id: b.id, entity: e.id, kind: 'modified' as const };
  const label = `${e.name}.${b.name}`;
  if (physicalColumn(model, a) !== physicalColumn(model, b))
    out.push({ ...base, description: `${label}: coluna renomeada ${physicalColumn(model, a)} → ${physicalColumn(model, b)}`, risk: 'risky', reason: 'Renomear coluna exige migration de rename; um gerador ingênuo faria DROP + ADD e perderia dados.' });
  if (a.domainType !== b.domainType) {
    const widening = (TYPE_WIDTH[a.domainType] ?? 0) > 0 && (TYPE_WIDTH[b.domainType] ?? 0) > (TYPE_WIDTH[a.domainType] ?? 0);
    out.push({ ...base, description: `${label}: tipo ${a.domainType} → ${b.domainType}`, risk: widening ? 'risky' : 'destructive', reason: widening ? 'Ampliação de tipo; verifique dependências.' : 'Conversão de tipo pode falhar ou truncar dados existentes.' });
  }
  if (a.length && (!b.length || b.length < a.length) && b.domainType === a.domainType && b.length)
    out.push({ ...base, description: `${label}: comprimento ${a.length} → ${b.length}`, risk: 'destructive', reason: 'Reduzir comprimento pode truncar ou rejeitar dados existentes.' });
  if ((a.precision ?? 0) > (b.precision ?? a.precision ?? 0) || (a.scale ?? 0) > (b.scale ?? a.scale ?? 0))
    out.push({ ...base, description: `${label}: precisão/escala reduzida`, risk: 'destructive', reason: 'Reduzir precisão pode arredondar ou rejeitar valores existentes.' });
  if (a.nullable && !b.nullable)
    out.push({ ...base, description: `${label}: passa a ser NOT NULL`, risk: b.default ? 'risky' : 'destructive', reason: b.default ? 'Linhas existentes com NULL precisam de backfill antes da restrição.' : 'Sem default, linhas existentes com NULL impedem a migration ou exigem backfill manual.' });
  if (!a.unique && b.unique)
    out.push({ ...base, description: `${label}: passa a ser UNIQUE`, risk: 'risky', reason: 'Dados existentes duplicados fariam a migration falhar.' });
  if (!out.length && canonicalJson(a) !== canonicalJson(b))
    out.push({ ...base, description: `${label}: propriedades alteradas`, risk: 'safe' });
  return out;
}

/** Semantic diff between two model versions with migration risk classification. */
export function diffModels(before: CanonicalModel, after: CanonicalModel): Change[] {
  const changes: Change[] = [];
  const prevEntities = new Map(before.entities.map((e) => [e.id, e]));
  for (const e of after.entities) {
    const p = prevEntities.get(e.id);
    prevEntities.delete(e.id);
    if (!p) {
      changes.push({ kind: 'added', element: 'entity', id: e.id, description: `Entidade ${e.name} adicionada`, risk: 'safe' });
      continue;
    }
    if (physicalTable(before, p) !== physicalTable(after, e))
      changes.push({ kind: 'modified', element: 'entity', id: e.id, description: `${e.name}: tabela renomeada ${physicalTable(before, p)} → ${physicalTable(after, e)}`, risk: 'risky', reason: 'Exige rename explícito para não recriar a tabela.' });
    const prevAttrs = new Map(p.attributes.map((a) => [a.id, a]));
    for (const a of e.attributes) {
      const pa = prevAttrs.get(a.id);
      prevAttrs.delete(a.id);
      if (!pa) {
        const risky = !a.nullable && !a.default && !a.generated;
        changes.push({ kind: 'added', element: 'attribute', id: a.id, entity: e.id, description: `${e.name}.${a.name} adicionado`, risk: risky ? 'risky' : 'safe', reason: risky ? 'Coluna NOT NULL sem default em tabela existente falha se houver linhas.' : undefined });
      } else changes.push(...attrChanges(after, e, pa, a));
    }
    for (const a of prevAttrs.values())
      changes.push({ kind: 'removed', element: 'attribute', id: a.id, entity: e.id, description: `${e.name}.${a.name} removido`, risk: 'destructive', reason: 'DROP COLUMN apaga os dados da coluna.' });
  }
  for (const e of prevEntities.values())
    changes.push({ kind: 'removed', element: 'entity', id: e.id, description: `Entidade ${e.name} removida`, risk: e.persistence === 'persistent' ? 'destructive' : 'safe', reason: 'DROP TABLE apaga todos os dados.' });

  const prevRels = new Map(before.relationships.map((r) => [r.id, r]));
  for (const r of after.relationships) {
    const p = prevRels.get(r.id);
    prevRels.delete(r.id);
    if (!p) changes.push({ kind: 'added', element: 'relationship', id: r.id, description: `Relacionamento ${r.name ?? r.id} adicionado`, risk: r.required ? 'risky' : 'safe', reason: r.required ? 'FK obrigatória em dados existentes exige que todas as linhas referenciem registros válidos.' : undefined });
    else if (canonicalJson(p) !== canonicalJson(r)) {
      const toCascade = r.onDelete === 'cascade' && p.onDelete !== 'cascade';
      changes.push({ kind: 'modified', element: 'relationship', id: r.id, description: `Relacionamento ${r.name ?? r.id} alterado${toCascade ? ' (ON DELETE CASCADE)' : ''}`, risk: toCascade || p.cardinality !== r.cardinality ? 'risky' : 'safe', reason: toCascade ? 'Exclusão em cascata passa a apagar dependentes.' : undefined });
    }
  }
  for (const r of prevRels.values())
    changes.push({ kind: 'removed', element: 'relationship', id: r.id, description: `Relacionamento ${r.name ?? r.id} removido`, risk: 'risky', reason: 'Remove a garantia de integridade referencial.' });

  const prevEnums = new Map(before.enums.map((x) => [x.id, x]));
  for (const en of after.enums) {
    const p = prevEnums.get(en.id);
    prevEnums.delete(en.id);
    if (!p) changes.push({ kind: 'added', element: 'enum', id: en.id, description: `Enum ${en.name} adicionado`, risk: 'safe' });
    else {
      const removed = p.values.filter((v) => !en.values.includes(v));
      if (removed.length)
        changes.push({ kind: 'modified', element: 'enum', id: en.id, description: `Enum ${en.name}: valores removidos ${removed.join(', ')}`, risk: 'destructive', reason: 'Linhas com os valores removidos ficam inválidas.' });
      else if (canonicalJson(p) !== canonicalJson(en))
        changes.push({ kind: 'modified', element: 'enum', id: en.id, description: `Enum ${en.name} alterado`, risk: 'safe' });
    }
  }
  for (const en of prevEnums.values())
    changes.push({ kind: 'removed', element: 'enum', id: en.id, description: `Enum ${en.name} removido`, risk: 'risky' });

  // Remaining collections: generic id-based comparison, no migration risk.
  const generic: Array<[string, Array<{ id: string }>, Array<{ id: string }>]> = [
    ['index', before.indexes, after.indexes],
    ['contract', before.contracts, after.contracts],
    ['mapping', before.mappings, after.mappings],
    ['query', before.queries, after.queries],
    ['question', before.questions, after.questions],
    ['hypothesis', before.hypotheses, after.hypotheses],
    ['decision', before.decisions, after.decisions],
    ['concept', before.domain.concepts, after.domain.concepts],
    ['rule', before.domain.rules, after.domain.rules],
  ];
  for (const [element, a, b] of generic) {
    const prev = new Map(a.map((x) => [x.id, x]));
    for (const x of b) {
      const p = prev.get(x.id);
      prev.delete(x.id);
      if (!p) changes.push({ kind: 'added', element, id: x.id, description: `${element} ${x.id} adicionado`, risk: element === 'index' ? 'risky' : 'safe', reason: element === 'index' ? 'Criar índice em tabela volumosa pode bloquear escrita; considere criação concorrente.' : undefined });
      else if (canonicalJson(p) !== canonicalJson(x)) changes.push({ kind: 'modified', element, id: x.id, description: `${element} ${x.id} alterado`, risk: 'safe' });
    }
    for (const x of prev.values()) changes.push({ kind: 'removed', element, id: x.id, description: `${element} ${x.id} removido`, risk: 'safe' });
  }
  return changes;
}
