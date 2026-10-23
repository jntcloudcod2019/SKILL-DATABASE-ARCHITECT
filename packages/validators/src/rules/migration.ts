import { diffModels, type Issue } from '@dbarchitect/core';
import { issue, type Rule } from '../rule.ts';

export const migrationRules: Rule[] = [
  {
    id: 'M001',
    category: 'migration',
    description: 'Alterações destrutivas ou arriscadas em relação ao modelo anterior.',
    run(model, ctx) {
      if (!ctx.previous) return [];
      const out: Issue[] = [];
      for (const c of diffModels(ctx.previous, model)) {
        if (c.risk === 'safe') continue;
        out.push(
          issue(this, c.risk === 'destructive' ? 'integrity' : 'warning', `${c.element}:${c.id}:${c.kind}`, {
            message: `${c.risk === 'destructive' ? 'Alteração destrutiva' : 'Alteração arriscada'}: ${c.description}`,
            target: { kind: c.element, id: c.id, entity: c.entity },
            rationale: c.reason ?? 'Pode afetar dados existentes.',
            recommendation: 'Planeje migration em etapas (expandir/migrar/contrair), faça backup e revise o script antes de aplicar. Nenhuma migration é aplicada automaticamente.',
            blocking: false,
          }),
        );
      }
      return out;
    },
  },
];
