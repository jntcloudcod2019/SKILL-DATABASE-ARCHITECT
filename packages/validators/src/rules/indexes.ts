import { findEntity, type Entity, type Issue } from '@dbarchitect/core';
import type { CanonicalModel } from '@dbarchitect/core';
import { attrName, issue, type Rule } from '../rule.ts';
import type { Index } from '@dbarchitect/core';

const cat = 'indexes';

/** Attribute lists (in order) that some index, PK or unique constraint already provides on the entity. */
export function accessPaths(model: CanonicalModel, e: Entity): string[][] {
  const paths: string[][] = [];
  const pk = e.attributes.filter((a) => a.primaryKey).map((a) => a.id);
  if (pk.length) paths.push(pk);
  for (const a of e.attributes) if (a.unique) paths.push([a.id]);
  for (const u of e.uniqueConstraints) paths.push(u.attributes);
  for (const i of model.indexes) if (i.entity === e.id) paths.push(i.attributes);
  return paths;
}

/** True when some access path starts with all `cols` (any order within the prefix). */
export function covered(paths: string[][], cols: string[]): boolean {
  return paths.some(
    (p) => p.length >= cols.length && cols.every((c) => p.slice(0, cols.length).includes(c)),
  );
}

export const invalidIndexes: Rule = {
  id: 'I001',
  category: cat,
  description: 'Índices inválidos ou duplicados.',
  run(model) {
    const out: Issue[] = [];
    const seen = new Map<string, string>();
    for (const i of model.indexes) {
      const e = findEntity(model, i.entity);
      const target = { kind: 'index', id: i.id, entity: i.entity };
      if (!e) {
        out.push(
          issue(this, 'critical', i.id, {
            message: `Índice ${i.name ?? i.id} referencia entidade inexistente ${i.entity}`,
            target,
            rationale: 'O índice não pode ser criado.',
            recommendation: 'Remova o índice ou corrija a entidade.',
          }),
        );
        continue;
      }
      const missing = i.attributes.filter((a) => !e.attributes.some((x) => x.id === a));
      if (missing.length)
        out.push(
          issue(this, 'critical', `${i.id}:attrs`, {
            message: `Índice ${i.name ?? i.id} em ${e.name} usa atributos inexistentes: ${missing.join(', ')}`,
            target,
            rationale: 'O índice não pode ser criado.',
            recommendation: 'Ajuste os atributos do índice.',
          }),
        );
      if (new Set(i.attributes).size !== i.attributes.length)
        out.push(
          issue(this, 'modeling', `${i.id}:repeat`, {
            message: `Índice ${i.name ?? i.id} repete o mesmo atributo`,
            target,
            rationale: 'Colunas repetidas em um índice são rejeitadas pela maioria dos bancos.',
            recommendation: 'Remova a repetição.',
          }),
        );
      const key = `${i.entity}:${i.attributes.join(',')}:${i.where ?? ''}`;
      const dup = seen.get(key);
      if (dup)
        out.push(
          issue(this, 'warning', `${i.id}:dup`, {
            message: `Índice ${i.name ?? i.id} duplica ${dup} em ${e.name}`,
            target,
            rationale: 'Índices duplicados custam escrita e espaço sem benefício de leitura.',
            recommendation: 'Remova um dos índices.',
            fixes: [{ id: 'remove-index', label: 'Remover este índice duplicado', description: `Remove ${i.name ?? i.id}; o outro índice idêntico permanece.`, actions: [{ type: 'removeIndex', id: i.id }] }],
          }),
        );
      else seen.set(key, i.name ?? i.id);
      if (!i.unique) {
        const pk = e.attributes.filter((a) => a.primaryKey).map((a) => a.id);
        const others = model.indexes.filter((o) => o.entity === i.entity && o.id !== i.id);
        const redundant =
          (pk.length >= i.attributes.length && i.attributes.every((a, k) => pk[k] === a)) ||
          others.some((o) => o.attributes.length > i.attributes.length && i.attributes.every((a, k) => o.attributes[k] === a));
        if (redundant)
          out.push(
            issue(this, 'suggestion', `${i.id}:prefix`, {
              message: `Índice ${i.name ?? i.id} em ${e.name} é prefixo de outro índice ou da PK`,
              target,
              rationale: 'Um índice composto já atende buscas pelo seu prefixo à esquerda.',
              recommendation: 'Avalie remover o índice redundante, salvo se ele existir por outra razão (ex.: índice parcial).',
              fixes: [{ id: 'remove-index', label: 'Remover índice redundante', description: `Remove ${i.name ?? i.id}; um índice mais amplo (ou a PK) já atende as buscas.`, actions: [{ type: 'removeIndex', id: i.id }] }],
            }),
          );
      }
      for (const a of i.attributes) {
        const attr = e.attributes.find((x) => x.id === a);
        if (attr && ['text', 'json', 'binary'].includes(attr.domainType) && i.method !== 'gin')
          out.push(
            issue(this, 'warning', `${i.id}:${a}:wide`, {
              message: `Índice ${i.name ?? i.id} inclui ${e.name}.${attr.name} (${attr.domainType})`,
              target,
              rationale: 'Colunas grandes em índices B-tree podem exceder limites de chave do banco.',
              recommendation: 'Use comprimento limitado, índice de expressão/hash ou um índice especializado.',
            }),
          );
      }
    }
    return out;
  },
};

export const foreignKeyIndexes: Rule = {
  id: 'I002',
  category: cat,
  description: 'Chaves estrangeiras sem índice de suporte.',
  run(model) {
    const out: Issue[] = [];
    for (const r of model.relationships) {
      if (r.cardinality === 'N:N' || !r.from.attributes.length) continue;
      const e = findEntity(model, r.from.entity);
      if (!e || e.persistence !== 'persistent') continue;
      if (covered(accessPaths(model, e), r.from.attributes)) continue;
      out.push(
        issue(this, 'performance', r.id, {
          message: `FK ${e.name}(${r.from.attributes.map((a) => attrName(e, a)).join(', ')}) sem índice de suporte`,
          target: { kind: 'relationship', id: r.id },
          rationale:
            'Sem índice, joins pela FK e a verificação de integridade ao excluir/atualizar o principal fazem varredura na tabela dependente. PostgreSQL e SQL Server não criam esse índice automaticamente.',
          recommendation: `Crie um índice em ${e.name}(${r.from.attributes.map((a) => attrName(e, a)).join(', ')}), a menos que a tabela seja pequena e raramente consultada por essa FK.`,
          fixes: [(() => { const index: Index = { id: `ix_${e.id}_${r.from.attributes.join('_')}`.slice(0, 110), entity: e.id, attributes: [...r.from.attributes], unique: false, rationale: 'Índice de suporte à chave estrangeira (correção sugerida).', provenance: { origin: 'manual', rationale: 'Criado pela correção sugerida da regra I002.' } }; return { id: 'add-fk-index', label: 'Criar índice na FK', description: `Cria índice em ${e.name}(${r.from.attributes.map((a) => attrName(e, a)).join(', ')}).`, actions: [{ type: 'addIndex' as const, index }] }; })()],
        }),
      );
    }
    return out;
  },
};

export const indexRules: Rule[] = [invalidIndexes, foreignKeyIndexes];
