import { findAttribute, findEntity, type Issue } from '@dbarchitect/core';
import { issue, type Rule } from '../rule.ts';

export const contractRules: Rule[] = [
  {
    id: 'C001',
    category: 'contracts',
    description: 'Divergências entre contratos externos e o modelo interno.',
    run(model) {
      const out: Issue[] = [];
      for (const m of model.mappings) {
        const c = model.contracts.find((x) => x.id === m.contract);
        const f = c?.fields.find((x) => x.path === m.field);
        const target = { kind: 'mapping', id: m.id };
        if (!c || !f) {
          out.push(
            issue(this, 'integrity', `${m.id}:ref`, {
              message: `Mapeamento ${m.id} aponta para contrato/campo inexistente (${m.contract}.${m.field})`,
              target,
              rationale: 'O contrato mudou ou o mapeamento foi digitado incorretamente.',
              recommendation: 'Reimporte o contrato ou corrija o mapeamento.',
            }),
          );
          continue;
        }
        if (m.treatment === 'stored') {
          const e = m.entity ? findEntity(model, m.entity) : undefined;
          const a = findAttribute(e, m.attribute ?? '');
          if (!e || !a) {
            out.push(
              issue(this, 'integrity', `${m.id}:dest`, {
                message: `${c.name}.${m.field} é "stored" mas o destino ${m.entity ?? '?'}.${m.attribute ?? '?'} não existe`,
                target,
                rationale: 'Campo marcado como armazenado precisa de destino.',
                recommendation: 'Escolha entidade/atributo ou mude o tratamento (derived, ignored, external-reference).',
              }),
            );
            continue;
          }
          if (f.requiredInResponse && a.nullable && !a.domainOptional)
            out.push(
              issue(this, 'domain', `${m.id}:resp`, {
                message: `${c.name}.${m.field} é obrigatório na resposta, mas ${e.name}.${a.name} aceita NULL`,
                target,
                rationale: 'A API promete um valor que o armazenamento pode não ter.',
                recommendation: 'Garanta o valor (NOT NULL/default) ou torne o campo opcional na resposta.',
              }),
            );
          if (f.nullable && !a.nullable && !a.domainOptional)
            out.push(
              issue(this, 'warning', `${m.id}:null`, {
                message: `${c.name}.${m.field} pode ser null no contrato, mas ${e.name}.${a.name} é NOT NULL`,
                target,
                rationale: 'Mensagens recebidas com null seriam rejeitadas pelo banco.',
                recommendation: 'Valide/defaulte antes de gravar, ou torne a coluna anulável se o negócio permitir.',
              }),
            );
          if (f.requiredInRequest && a.nullable && a.requiredWhen?.length === undefined && !a.domainOptional)
            out.push(
              issue(this, 'suggestion', `${m.id}:req`, {
                message: `${c.name}.${m.field} é obrigatório na requisição; ${e.name}.${a.name} é anulável`,
                target,
                rationale: 'Obrigatório na entrada não implica NOT NULL, mas aqui o domínio também não declara opcionalidade.',
                recommendation: 'Confirme se há estados em que o valor pode estar ausente; se não, use NOT NULL.',
              }),
            );
        }
      }
      for (const c of model.contracts) {
        const mapped = model.mappings.filter((m) => m.contract === c.id).length;
        if (c.fields.length && mapped < c.fields.length)
          out.push(
            issue(this, 'suggestion', `${c.id}:unmapped`, {
              message: `Contrato ${c.name}: ${c.fields.length - mapped} de ${c.fields.length} campos sem tratamento definido`,
              target: { kind: 'contract', id: c.id },
              rationale: 'Cada campo deve ser armazenado, derivado, ignorado ou referência externa — por decisão, não por omissão.',
              recommendation: 'Defina o tratamento dos campos restantes no painel de contratos.',
            }),
          );
      }
      return out;
    },
  },
];
