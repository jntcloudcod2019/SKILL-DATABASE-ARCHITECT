import type { Origin, Provenance, Severity } from '@dbarchitect/core';
import { ORIGIN_ICON, ORIGIN_LABEL } from './store.ts';

export function OriginBadge({ p }: { p: Provenance }) {
  const label = p.manuallyEdited ? ORIGIN_LABEL.manual : ORIGIN_LABEL[p.origin];
  const cls: Origin = p.manuallyEdited ? 'manual' : p.origin;
  return <span className={`badge o-${cls}`} title={p.rationale ?? label}><span aria-hidden>{ORIGIN_ICON[cls]}</span>{label}{p.confidence ? ` · ${p.confidence}` : ''}</span>;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Erro crítico', modeling: 'Erro de modelagem', domain: 'Inconsistência de domínio', integrity: 'Risco de integridade',
  performance: 'Risco de performance', warning: 'Aviso', 'pending-decision': 'Decisão pendente', suggestion: 'Sugestão de melhoria',
};
export const SEVERITY_ORDER: Severity[] = ['critical', 'modeling', 'domain', 'integrity', 'performance', 'warning', 'pending-decision', 'suggestion'];

export const STATE_STEPS = ['DISCOVERING', 'ANALYZING', 'DRAFT', 'NEEDS_INPUT', 'VALIDATING', 'READY_FOR_REVIEW', 'APPROVED', 'GENERATING', 'GENERATED'];

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label>{label}</label>{children}</div>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return <div className="empty"><b>{title}</b>{hint && <p>{hint}</p>}</div>;
}

export function DiffText({ text }: { text: string }) {
  return <pre className="diff">{text.split('\n').map((l, i) => <div key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l || ' '}</div>)}</pre>;
}

export function newId(prefix: string, taken: string[]): string {
  let i = taken.length + 1;
  while (taken.includes(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'item';
}
