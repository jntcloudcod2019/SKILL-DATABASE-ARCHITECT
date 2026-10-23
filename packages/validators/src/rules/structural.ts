import { findEntity, physicalColumn, physicalTable, type Issue } from '@dbarchitect/core';
import { attrName, issue, persistent, type Rule } from '../rule.ts';
import { setAttr, surrogateKeyFix } from '../fix-builders.ts';
import type { Fix } from '@dbarchitect/core';

const cat = 'structural';

function dupes(values: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const v of values) (seen.has(v) ? out : seen).add(v);
  return [...out];
}

export const duplicateIdentifiers: Rule = {
  id: 'S001',
  category: cat,
  description: 'Identificadores duplicados em entidades, atributos, relacionamentos, índices e nomes físicos.',
  run(model) {
    const out: Issue[] = [];
    const groups: Array<[string, string[]]> = [
      ['entidade', model.entities.map((e) => e.id)],
      ['relacionamento', model.relationships.map((r) => r.id)],
      ['índice', model.indexes.map((i) => i.id)],
      ['enum', model.enums.map((x) => x.id)],
      ['tabela', persistent(model).map((e) => physicalTable(model, e).toLowerCase())],
    ];
    for (const e of model.entities) {
      groups.push([`atributo de ${e.name}`, e.attributes.map((a) => a.id)]);
      groups.push([`coluna de ${e.name}`, e.attributes.map((a) => physicalColumn(model, a).toLowerCase())]);
    }
    for (const [what, ids] of groups)
      for (const d of dupes(ids))
        out.push(
          issue(this, 'critical', `${what}:${d}`, {
            message: `Identificador duplicado (${what}): ${d}`,
            rationale: 'Identificadores precisam ser únicos para que referências, diffs e geração sejam determinísticos.',
            recommendation: 'Renomeie ou remova o elemento duplicado.',
          }),
        );
    return out;
  },
};

export const missingPrimaryKey: Rule = {
  id: 'S002',
  category: cat,
  description: 'Entidades persistentes sem chave primária.',
  run(model) {
    return persistent(model)
      .filter((e) => !e.attributes.some((a) => a.primaryKey))
      .map((e) =>
        issue(this, 'modeling', e.id, {
          message: `${e.name} não possui chave primária`,
          target: { kind: 'entity', id: e.id },
          rationale: 'Sem identidade a linha não pode ser referenciada nem atualizada de forma confiável.',
          recommendation:
            e.kind === 'association'
              ? 'Marque as FKs da associação como chave primária composta ou adicione uma chave substituta.'
              : `Defina a identidade de ${e.name} (estratégia do projeto: ${model.conventions.primaryKeyStrategy}).`,
          fixes: [surrogateKeyFix(model, e)].filter((f): f is Fix => !!f),
        }),
      );
  },
};

export const invalidReferences: Rule = {
  id: 'S003',
  category: cat,
  description: 'Relacionamentos, restrições e enums que apontam para elementos inexistentes.',
  run(model) {
    const out: Issue[] = [];
    for (const r of model.relationships) {
      for (const end of ['from', 'to'] as const) {
        const e = findEntity(model, r[end].entity);
        if (!e) {
          out.push(
            issue(this, 'critical', `${r.id}:${end}`, {
              message: `Relacionamento ${r.name ?? r.id} referencia entidade inexistente "${r[end].entity}"`,
              target: { kind: 'relationship', id: r.id },
              rationale: 'Uma chave estrangeira para uma tabela inexistente não pode ser criada.',
              recommendation: 'Corrija a entidade de destino ou remova o relacionamento.',
            }),
          );
          continue;
        }
        for (const a of r[end].attributes)
          if (!e.attributes.some((x) => x.id === a))
            out.push(
              issue(this, 'critical', `${r.id}:${end}:${a}`, {
                message: `Relacionamento ${r.name ?? r.id} referencia atributo inexistente ${e.name}.${a}`,
                target: { kind: 'relationship', id: r.id },
                rationale: 'As colunas da chave estrangeira precisam existir.',
                recommendation: `Crie o atributo em ${e.name} ou ajuste o relacionamento.`,
              }),
            );
      }
      if (r.through && !findEntity(model, r.through))
        out.push(
          issue(this, 'critical', `${r.id}:through`, {
            message: `Tabela de associação "${r.through}" não existe`,
            target: { kind: 'relationship', id: r.id },
            rationale: 'N:N precisa de uma entidade de associação real.',
            recommendation: 'Crie a entidade de associação ou corrija a referência.',
          }),
        );
    }
    const enumIds = new Set(model.enums.map((x) => x.id));
    for (const e of model.entities) {
      const ids = new Set(e.attributes.map((a) => a.id));
      for (const u of e.uniqueConstraints)
        for (const a of u.attributes)
          if (!ids.has(a))
            out.push(
              issue(this, 'critical', `${e.id}:${u.id}:${a}`, {
                message: `Restrição de unicidade ${u.name ?? u.id} em ${e.name} usa atributo inexistente ${a}`,
                target: { kind: 'entity', id: e.id },
                rationale: 'A restrição não pode ser criada.',
                recommendation: 'Ajuste os atributos da restrição.',
              }),
            );
      for (const a of e.attributes) {
        if (a.enumRef && !enumIds.has(a.enumRef))
          out.push(
            issue(this, 'critical', `${e.id}:${a.id}:enum`, {
              message: `${e.name}.${a.name} referencia enum inexistente ${a.enumRef}`,
              target: { kind: 'attribute', id: a.id, entity: e.id },
              rationale: 'O conjunto de valores válidos é desconhecido.',
              recommendation: 'Crie o enum ou corrija a referência.',
            }),
          );
        if (a.domainType === 'enum' && !a.enumRef && !a.allowedValues?.length)
          out.push(
            issue(this, 'modeling', `${e.id}:${a.id}:enumvals`, {
              message: `${e.name}.${a.name} é enum sem valores definidos`,
              target: { kind: 'attribute', id: a.id, entity: e.id },
              rationale: 'Sem valores válidos o banco não pode restringir o domínio.',
              recommendation: 'Defina enumRef ou allowedValues.',
            }),
          );
      }
    }
    return out;
  },
};

export const foreignKeys: Rule = {
  id: 'S004',
  category: cat,
  description: 'Chaves estrangeiras ausentes, incompatíveis ou com cardinalidade inconsistente.',
  run(model) {
    const out: Issue[] = [];
    for (const r of model.relationships) {
      const from = findEntity(model, r.from.entity);
      const to = findEntity(model, r.to.entity);
      if (!from || !to) continue; // reported by S003
      const target = { kind: 'relationship', id: r.id };
      const label = r.name ?? `${from.name} → ${to.name}`;
      if (r.cardinality === 'N:N') {
        if (!r.through)
          out.push(
            issue(this, 'modeling', `${r.id}:nn`, {
              message: `${label}: N:N sem entidade de associação`,
              target,
              rationale: 'Bancos relacionais representam N:N com uma tabela de associação; ela costuma carregar dados próprios (datas, quantidades).',
              recommendation: 'Crie uma entidade de associação e dois relacionamentos N:1, ou informe "through".',
            }),
          );
        continue;
      }
      if (!r.from.attributes.length) {
        out.push(
          issue(this, 'modeling', `${r.id}:fk`, {
            message: `${label}: chave estrangeira ausente`,
            target,
            rationale: 'Um relacionamento persistido precisa de colunas que referenciem a entidade principal.',
            recommendation: `Adicione o atributo FK em ${from.name} (ex.: ${to.name[0].toLowerCase() + to.name.slice(1)}Id).`,
          }),
        );
        continue;
      }
      const toAttrs = r.to.attributes.length ? r.to.attributes : to.attributes.filter((a) => a.primaryKey).map((a) => a.id);
      if (toAttrs.length !== r.from.attributes.length)
        out.push(
          issue(this, 'modeling', `${r.id}:arity`, {
            message: `${label}: ${r.from.attributes.length} coluna(s) de FK para ${toAttrs.length} coluna(s) de chave`,
            target,
            rationale: 'A FK precisa ter o mesmo número de colunas da chave referenciada.',
            recommendation: 'Alinhe as colunas da FK com a chave primária/única do destino.',
          }),
        );
      const referencedIsKey =
        toAttrs.every((id) => to.attributes.find((a) => a.id === id)?.primaryKey) ||
        (toAttrs.length === 1 && to.attributes.find((a) => a.id === toAttrs[0])?.unique) ||
        to.uniqueConstraints.some((u) => u.attributes.length === toAttrs.length && u.attributes.every((x) => toAttrs.includes(x)));
      if (!referencedIsKey)
        out.push(
          issue(this, 'modeling', `${r.id}:refkey`, {
            message: `${label}: colunas referenciadas em ${to.name} não são chave primária nem única`,
            target,
            rationale: 'Bancos exigem que a FK referencie uma chave candidata.',
            recommendation: 'Referencie a PK ou declare unicidade nas colunas referenciadas.',
          }),
        );
      r.from.attributes.forEach((fa, i) => {
        const a = from.attributes.find((x) => x.id === fa);
        const b = to.attributes.find((x) => x.id === toAttrs[i]);
        if (a && b && a.domainType !== b.domainType)
          out.push(
            issue(this, 'modeling', `${r.id}:type:${fa}`, {
              message: `${label}: ${from.name}.${a.name} (${a.domainType}) não é compatível com ${to.name}.${b.name} (${b.domainType})`,
              target,
              rationale: 'Tipos diferentes impedem a FK ou forçam conversões implícitas.',
              recommendation: `Use ${b.domainType} em ${from.name}.${a.name}.`,
              fixes: [{ id: 'align-fk-type', label: `Usar ${b.domainType} na FK`, description: `${from.name}.${a.name}: domainType ${a.domainType} → ${b.domainType} (igual à chave de ${to.name}).`, actions: [setAttr(from.id, a.id, { domainType: b.domainType, ...(b.length ? { length: b.length } : {}) })] }],
            }),
          );
      });
      if (r.cardinality === '1:1') {
        const fks = r.from.attributes;
        const isUnique =
          (fks.length === 1 && from.attributes.find((a) => a.id === fks[0])?.unique) ||
          fks.every((id) => from.attributes.find((a) => a.id === id)?.primaryKey) ||
          from.uniqueConstraints.some((u) => u.attributes.length === fks.length && u.attributes.every((x) => fks.includes(x)));
        if (!isUnique)
          out.push(
            issue(this, 'modeling', `${r.id}:1to1`, {
              message: `${label}: cardinalidade 1:1 mas a FK ${fks.map((x) => attrName(from, x)).join(', ')} não é única`,
              target,
              rationale: 'Sem unicidade o banco aceita vários dependentes por principal, ou seja, N:1.',
              recommendation: 'Declare a FK como única ou altere a cardinalidade para N:1.',
              fixes: [
                { id: 'fk-unique', label: 'Tornar a FK única (manter 1:1)', description: `${from.name}: a(s) coluna(s) da FK passam a ter restrição UNIQUE.`, actions: fks.length === 1 ? [setAttr(from.id, fks[0], { unique: true })] : [] },
                { id: 'to-n1', label: 'Mudar cardinalidade para N:1', description: 'Vários dependentes podem referenciar o mesmo principal.', decision: true, actions: [{ type: 'setRelationship', relationship: r.id, set: { cardinality: 'N:1' } }] },
              ].filter((f) => f.actions.length) as Fix[],
            }),
          );
      }
    }
    return out;
  },
};

export const nullability: Rule = {
  id: 'S005',
  category: cat,
  description: 'Nulabilidade contraditória entre chave, relacionamento, domínio e coluna.',
  run(model) {
    const out: Issue[] = [];
    for (const e of model.entities)
      for (const a of e.attributes) {
        const target = { kind: 'attribute', id: a.id, entity: e.id };
        if (a.primaryKey && a.nullable)
          out.push(
            issue(this, 'critical', `${e.id}:${a.id}:pk`, {
              message: `${e.name}.${a.name} é chave primária e anulável`,
              target,
              rationale: 'Chaves primárias não admitem NULL.',
              recommendation: 'Marque o atributo como não anulável.',
              fixes: [{ id: 'not-null', label: 'Tornar NOT NULL', description: `${e.name}.${a.name}: nullable=false.`, actions: [setAttr(e.id, a.id, { nullable: false })] }],
            }),
          );
        if (a.requiredWhen?.length && !a.nullable)
          out.push(
            issue(this, 'domain', `${e.id}:${a.id}:cond`, {
              message: `${e.name}.${a.name} é obrigatório só sob condição (${a.requiredWhen.map((c) => c.condition).join('; ')}) mas a coluna é NOT NULL`,
              target,
              rationale: 'Obrigatoriedade condicional ao estado de negócio não equivale a NOT NULL em todo o ciclo de vida.',
              recommendation: 'Torne a coluna anulável e garanta a condição com CHECK ou na aplicação — ou remova a condição se o valor sempre existe.',
              fixes: [{ id: 'nullable', label: 'Tornar a coluna anulável', description: `${e.name}.${a.name}: nullable=true; a obrigatoriedade segue em requiredWhen.`, actions: [setAttr(e.id, a.id, { nullable: true })] }],
            }),
          );
        if (!a.domainOptional && a.nullable && !a.requiredWhen?.length && !a.primaryKey)
          out.push(
            issue(this, 'domain', `${e.id}:${a.id}:dom`, {
              message: `${e.name}.${a.name} é obrigatório no domínio mas a coluna aceita NULL`,
              target,
              rationale: 'O banco não protege uma invariante que o domínio declara.',
              recommendation: 'Torne a coluna NOT NULL, ou registre em requiredWhen a condição em que o valor é exigido.',
              fixes: [
                { id: 'not-null', label: 'Tornar NOT NULL', description: `${e.name}.${a.name}: nullable=false (o banco passa a proteger a regra).`, actions: [setAttr(e.id, a.id, { nullable: false })] },
                { id: 'domain-optional', label: 'Declarar opcional no domínio', description: `${e.name}.${a.name}: domainOptional=true — o negócio admite ausência.`, decision: true, actions: [setAttr(e.id, a.id, { domainOptional: true })] },
              ],
            }),
          );
        if (a.domainOptional && !a.nullable && !a.default && !a.generated && !a.primaryKey)
          out.push(
            issue(this, 'domain', `${e.id}:${a.id}:dom2`, {
              message: `${e.name}.${a.name} é opcional no domínio mas a coluna é NOT NULL sem default`,
              target,
              rationale: 'Inserções sem o valor falharão, contrariando a regra de domínio.',
              recommendation: 'Torne a coluna anulável ou defina um default justificado.',
              fixes: [{ id: 'nullable', label: 'Tornar a coluna anulável', description: `${e.name}.${a.name}: nullable=true.`, actions: [setAttr(e.id, a.id, { nullable: true })] }],
            }),
          );
      }
    for (const r of model.relationships) {
      const from = findEntity(model, r.from.entity);
      if (!from || r.cardinality === 'N:N') continue;
      const fks = r.from.attributes.map((id) => from.attributes.find((a) => a.id === id)).filter((a) => !!a);
      const label = r.name ?? r.id;
      const target = { kind: 'relationship', id: r.id };
      if (r.required && fks.some((a) => a.nullable))
        out.push(
          issue(this, 'modeling', `${r.id}:req`, {
            message: `${label}: associação obrigatória mas a FK aceita NULL`,
            target,
            rationale: 'Obrigatoriedade da associação e nulabilidade da FK se contradizem.',
            recommendation: 'Torne a FK NOT NULL ou marque a associação como opcional.',
            fixes: [
              { id: 'fk-not-null', label: 'Tornar a FK NOT NULL', description: 'A associação continua obrigatória; o banco passa a exigir a FK.', actions: r.from.attributes.map((id) => setAttr(from.id, id, { nullable: false })) },
              { id: 'rel-optional', label: 'Marcar a associação como opcional', description: 'A FK continua anulável; o negócio admite dependente sem principal.', decision: true, actions: [{ type: 'setRelationship', relationship: r.id, set: { required: false } }] },
            ],
          }),
        );
      if (!r.required && fks.length && fks.every((a) => !a.nullable) && !fks.some((a) => a.primaryKey))
        out.push(
          issue(this, 'modeling', `${r.id}:opt`, {
            message: `${label}: associação opcional mas a FK é NOT NULL`,
            target,
            rationale: 'Uma FK NOT NULL torna a associação obrigatória na prática.',
            recommendation: 'Torne a FK anulável ou marque a associação como obrigatória.',
            fixes: [
              { id: 'rel-required', label: 'Marcar a associação como obrigatória', description: 'Coerente com a FK NOT NULL já existente.', actions: [{ type: 'setRelationship', relationship: r.id, set: { required: true } }] },
              { id: 'fk-nullable', label: 'Tornar a FK anulável', description: 'A associação passa a poder existir sem principal.', decision: true, actions: r.from.attributes.map((id) => setAttr(from.id, id, { nullable: true })) },
            ],
          }),
        );
      if (r.onDelete === 'set-null' && fks.some((a) => !a.nullable))
        out.push(
          issue(this, 'modeling', `${r.id}:setnull`, {
            message: `${label}: ON DELETE SET NULL com FK NOT NULL`,
            target,
            rationale: 'A exclusão do principal falharia ao tentar anular a FK.',
            recommendation: 'Use RESTRICT/NO ACTION ou torne a FK anulável.',
            fixes: [
              { id: 'on-delete-restrict', label: 'Trocar para RESTRICT', description: 'A exclusão do principal é bloqueada enquanto houver dependentes.', actions: [{ type: 'setRelationship', relationship: r.id, set: { onDelete: 'restrict' } }] },
              { id: 'fk-nullable', label: 'Tornar a FK anulável (mantém SET NULL)', description: 'Dependentes ficam órfãos ao excluir o principal.', decision: true, actions: r.from.attributes.map((id) => setAttr(from.id, id, { nullable: true })) },
            ],
          }),
        );
    }
    return out;
  },
};

export const structuralRules: Rule[] = [duplicateIdentifiers, missingPrimaryKey, invalidReferences, foreignKeys, nullability];
