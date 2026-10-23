import type { CanonicalModel, Issue, Severity } from '@dbarchitect/core';
import type { Rule, ValidationContext } from './rule.ts';
import { structuralRules } from './rules/structural.ts';
import { indexRules } from './rules/indexes.ts';
import { typeRules } from './rules/types.ts';
import { integrityRules } from './rules/integrity.ts';
import { domainRules } from './rules/domain.ts';
import { contractRules } from './rules/contracts.ts';
import { performanceRules } from './rules/performance.ts';
import { migrationRules } from './rules/migration.ts';

export type { Rule, ValidationContext } from './rule.ts';
export { issue, BLOCKING } from './rule.ts';
export { applyFix, applyFixAction, FixError } from './fixes.ts';

export const allRules: Rule[] = [
  ...structuralRules,
  ...typeRules,
  ...indexRules,
  ...integrityRules,
  ...domainRules,
  ...contractRules,
  ...performanceRules,
  ...migrationRules,
];

const ORDER: Severity[] = ['critical', 'modeling', 'domain', 'integrity', 'performance', 'warning', 'pending-decision', 'suggestion'];

export interface ValidationResult {
  issues: Issue[];
  blocking: number;
  bySeverity: Record<Severity, number>;
}

/** Pure and deterministic: no AI, no I/O. Extend by passing extra rules. */
export function validateModel(model: CanonicalModel, ctx: ValidationContext = {}, extra: Rule[] = []): ValidationResult {
  const issues = [...allRules, ...extra].flatMap((r) => r.run(model, ctx));
  issues.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.id.localeCompare(b.id));
  const bySeverity = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  for (const i of issues) bySeverity[i.severity]++;
  return { issues, blocking: issues.filter((i) => i.blocking).length, bySeverity };
}
