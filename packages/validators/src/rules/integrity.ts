import { findEntity, type Issue } from '@dbarchitect/core';
import { issue, persistent, type Rule } from '../rule.ts';
import type { Fix } from '@dbarchitect/core';

const cat = 'integrity';

export const cascadeRisk: Rule = {
  id: 'R001',
  category: cat,
  description: 'Riscos de exclusão em cascata.',
  run(model, ctx) {
    const out: Issue[] = [];
    const cascades = model.relationships.filter((r) => r.onDelete === 'cascade' && r.cardinality !== 'N:N');
    const childrenOf = new Map<string, string[]>();
    for (const r of cascades) childrenOf.set(r.to.entity, [...(childrenOf.get(r.to.entity) ?? []), r.from.entity]);
    for (const r of cascades) {
      const from = findEntity(model, r.from.entity);
      const to = findEntity(model, r.to.entity);
      if (!from || !to) continue;
      const chain = childrenOf.get(r.from.entity) ?? [];
      if (!r.identifying || chain.length)
        out.push(
          issue(this, 'integrity', `${r.id}:cascade`, {
            message: `Excluir ${to.name} apaga ${from.name} em cascata${chain.length ? ` (e, em cadeia, ${chain.map((c) => findEntity(model, c)?.name ?? c).join(', ')})` : ''}`,
            target: { kind: 'relationship', id: r.id },
            rationale: r.identifying
              ? 'A cascata se propaga por mais de um nível; uma exclusão pode remover muito mais dados que o esperado.'
              : `${from.name} não está marcado como dependente existencial (relacionamento identificador) de ${to.name}; a cascata pode apagar registros de negócio com vida própria.`,
            recommendation: 'Use RESTRICT/NO ACTION e exclusão explícita (ou exclusão lógica), ou marque o relacionamento como identificador se a dependência existencial for real.',
            fixes: [
              { id: 'on-delete-restrict', label: 'Trocar para RESTRICT', description: `${to.name} não poderá ser excluído enquanto houver ${from.name} dependente. A exclusão passa a ser explícita.`, actions: [{ type: 'setRelationship', relationship: r.id, set: { onDelete: 'restrict' } }] },
              { id: 'mark-identifying', label: 'Manter CASCADE e marcar como identificador', description: `Declara que ${from.name} não existe sem ${to.name} (dependência existencial). Use só se for verdade no negócio.`, decision: true, actions: [{ type: 'setRelationship', relationship: r.id, set: { identifying: true } }] },
            ] satisfies Fix[],
          }),
        );
    }
    if (ctx.dialect?.id === 'sqlserver') {
      // SQL Server rejects multiple cascade paths to the same table.
      for (const e of persistent(model)) {
        const incoming = cascades.filter((r) => r.from.entity === e.id);
        const parents = new Set(incoming.map((r) => r.to.entity));
        if (incoming.length > 1 && parents.size < incoming.length + 0)
          out.push(
            issue(this, 'modeling', `${e.id}:multicascade`, {
              message: `${e.name} recebe múltiplos caminhos de cascata`,
              target: { kind: 'entity', id: e.id },
              rationale: 'SQL Server rejeita FKs que criam múltiplos caminhos de cascata para a mesma tabela.',
              recommendation: 'Mantenha no máximo um caminho em cascata; use NO ACTION nos demais.',
            }),
          );
      }
    }
    return out;
  },
};

export const tenancy: Rule = {
  id: 'R002',
  category: cat,
  description: 'Inconsistências de isolamento por tenant.',
  run(model) {
    const out: Issue[] = [];
    const t = model.conventions.tenancy;
    if (t.strategy !== 'column' || !t.column) return out;
    const col = t.column.toLowerCase();
    const hasTenant = (id: string) =>
      findEntity(model, id)?.attributes.some((a) => a.name.toLowerCase() === col || a.column?.toLowerCase() === col);
    for (const e of persistent(model)) {
      if (e.tenantScoped === false || e.kind === 'reference') continue;
      if (!hasTenant(e.id))
        out.push(
          issue(this, 'integrity', `${e.id}:tenant`, {
            message: `${e.name} não possui a coluna de tenant "${t.column}"`,
            target: { kind: 'entity', id: e.id },
            rationale: 'Com isolamento por coluna, toda tabela de dados de tenant precisa da coluna para filtrar e proteger acesso.',
            recommendation: `Adicione ${t.column} a ${e.name} ou marque a entidade como tenantScoped: false (dados globais).`,
          }),
        );
    }
    for (const r of model.relationships) {
      const from = findEntity(model, r.from.entity);
      const to = findEntity(model, r.to.entity);
      if (!from || !to || from.tenantScoped === false || to.tenantScoped === false) continue;
      if (!hasTenant(from.id) || !hasTenant(to.id)) continue;
      const fkHasTenant = r.from.attributes.some((id) => {
        const a = from.attributes.find((x) => x.id === id);
        return a?.name.toLowerCase() === col || a?.column?.toLowerCase() === col;
      });
      if (!fkHasTenant)
        out.push(
          issue(this, 'warning', `${r.id}:xtenant`, {
            message: `${r.name ?? r.id}: a FK não inclui ${t.column}; o banco permite referenciar registros de outro tenant`,
            target: { kind: 'relationship', id: r.id },
            rationale: 'Sem a coluna de tenant na FK composta, apenas a aplicação impede referências cruzadas entre tenants.',
            recommendation: `Considere FK composta (${t.column}, id) ou garanta a regra com RLS/aplicação e documente a decisão.`,
          }),
        );
    }
    return out;
  },
};

export const redundancy: Rule = {
  id: 'R003',
  category: cat,
  description: 'Campos possivelmente redundantes entre entidades relacionadas.',
  run(model) {
    const out: Issue[] = [];
    for (const r of model.relationships) {
      const from = findEntity(model, r.from.entity);
      const to = findEntity(model, r.to.entity);
      if (!from || !to || r.cardinality === 'N:N') continue;
      for (const a of from.attributes) {
        if (a.primaryKey || r.from.attributes.includes(a.id) || a.derived) continue;
        const twin = to.attributes.find(
          (b) => !b.primaryKey && b.name.toLowerCase() === a.name.toLowerCase() && b.domainType === a.domainType,
        );
        if (twin)
          out.push(
            issue(this, 'suggestion', `${from.id}:${a.id}:dup`, {
              message: `${from.name}.${a.name} repete ${to.name}.${twin.name}`,
              target: { kind: 'attribute', id: a.id, entity: from.id },
              rationale:
                'Pode ser desnormalização intencional (ex.: snapshot do preço no momento do pedido) ou duplicação que diverge com o tempo. O contexto não permite concluir automaticamente.',
              recommendation:
                'Se for snapshot histórico, documente a justificativa no atributo. Se não, remova e obtenha o valor pelo relacionamento.',
            }),
          );
      }
    }
    return out;
  },
};

export const integrityRules: Rule[] = [cascadeRisk, tenancy, redundancy];
