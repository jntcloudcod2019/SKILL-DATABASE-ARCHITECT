import type { CanonicalModel, Dialect, Entity, Issue, Severity } from '@dbarchitect/core';

export interface ValidationContext {
  /** Present when the physical profile names a database; enables dialect checks. */
  dialect?: Dialect;
  /** Previously approved/generated model, enables destructive-change checks. */
  previous?: CanonicalModel;
}

export interface Rule {
  id: string;
  category: string;
  description: string;
  run(model: CanonicalModel, ctx: ValidationContext): Issue[];
}

/** Severities that block approval. Everything else is advisory. */
export const BLOCKING: ReadonlySet<Severity> = new Set(['critical', 'modeling']);

export function issue(
  rule: Rule | { id: string; category: string },
  severity: Severity,
  key: string,
  fields: Omit<Issue, 'id' | 'rule' | 'category' | 'severity' | 'blocking'> & { blocking?: boolean },
): Issue {
  return {
    id: `${rule.id}:${key}`,
    rule: rule.id,
    category: rule.category,
    severity,
    ...fields,
    blocking: fields.blocking ?? BLOCKING.has(severity),
  };
}

export function persistent(model: CanonicalModel): Entity[] {
  return model.entities.filter((e) => e.persistence === 'persistent');
}

export function attrName(e: Entity | undefined, id: string): string {
  return e?.attributes.find((a) => a.id === id)?.name ?? id;
}
