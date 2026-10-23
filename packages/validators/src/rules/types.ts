import type { Issue } from '@dbarchitect/core';
import { issue, type Rule } from '../rule.ts';
import { lengthFixes, precisionFixes } from '../fix-builders.ts';

export const typeRules: Rule[] = [
  {
    id: 'T001',
    category: 'types',
    description: 'Tipos, comprimentos e precisões incompatíveis com o domínio ou com o dialeto de destino.',
    run(model, ctx) {
      const out: Issue[] = [];
      for (const e of model.entities)
        for (const a of e.attributes) {
          const target = { kind: 'attribute', id: a.id, entity: e.id };
          const label = `${e.name}.${a.name}`;
          if ((a.domainType === 'decimal' || a.domainType === 'money') && !a.precision && !a.physicalType)
            out.push(
              issue(this, 'modeling', `${a.id}@${e.id}:prec`, {
                message: `${label} (${a.domainType}) sem precisão definida`,
                target,
                rationale: 'Cada banco aplica uma precisão padrão diferente; valores monetários precisam de escala explícita.',
                recommendation: 'Defina precision e scale (ex.: 18,2 para valores monetários em moeda com centavos).',
                fixes: precisionFixes(e, a),
              }),
            );
          if (a.scale !== undefined && a.precision !== undefined && a.scale > a.precision)
            out.push(
              issue(this, 'critical', `${a.id}@${e.id}:scale`, {
                message: `${label}: escala ${a.scale} maior que precisão ${a.precision}`,
                target,
                rationale: 'Combinação inválida em todos os bancos relacionais.',
                recommendation: 'Ajuste precision/scale.',
              }),
            );
          if (a.domainType === 'string' && !a.length && !a.physicalType && !a.primaryKey)
            out.push(
              issue(this, 'suggestion', `${a.id}@${e.id}:len`, {
                message: `${label} é string sem comprimento máximo`,
                target,
                rationale: 'Sem limite, o tipo vira texto ilimitado e índices/validações ficam imprecisos.',
                recommendation: 'Defina length com base na regra de negócio, ou use domainType "text" se o texto é livre.',
                fixes: lengthFixes(e, a),
              }),
            );
          if (ctx.dialect) {
            if (a.precision && a.precision > ctx.dialect.maxDecimalPrecision)
              out.push(
                issue(this, 'modeling', `${a.id}@${e.id}:dprec`, {
                  message: `${label}: precisão ${a.precision} excede o máximo de ${ctx.dialect.id} (${ctx.dialect.maxDecimalPrecision})`,
                  target,
                  rationale: 'O DDL será rejeitado pelo banco de destino.',
                  recommendation: `Reduza a precisão para ≤ ${ctx.dialect.maxDecimalPrecision}.`,
                }),
              );
            if (ctx.dialect.maxVarchar && a.domainType === 'string' && a.length && a.length > ctx.dialect.maxVarchar)
              out.push(
                issue(this, 'warning', `${a.id}@${e.id}:vlen`, {
                  message: `${label}: comprimento ${a.length} excede varchar máximo de ${ctx.dialect.id} (${ctx.dialect.maxVarchar}); será gerado como tipo de texto longo`,
                  target,
                  rationale: 'Tipos longos têm restrições de indexação diferentes.',
                  recommendation: 'Confirme se o limite é real ou use domainType "text".',
                }),
              );
          }
        }
      return out;
    },
  },
];
