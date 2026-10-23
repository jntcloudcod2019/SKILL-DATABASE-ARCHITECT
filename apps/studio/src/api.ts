import type { CanonicalModel, Change, Issue, Op } from '@dbarchitect/core';

export interface Status {
  project: string; mode: string; state: string; revision: number; hash: string;
  counts: Record<string, number>;
  pending: { questions: number; critical: number; hypotheses: number };
  approval: { approvedBy: string; approvedAt: string; revision: number } | null;
  domainApproved: boolean;
  profile: CanonicalModel['project']['profile'];
  lastValidation: { hash: string; at: string; blocking: number; total: number } | null;
  versions: number[];
}
export interface Layout { domain: Record<string, { x: number; y: number }>; data: Record<string, { x: number; y: number }> }
export interface Bundle { model: CanonicalModel; hash: string; status: Status; issues: Issue[]; layout: Layout; baseline: CanonicalModel | null }
export interface SupportRow { target: string; dialect: string; verification: string }
export interface PlanItem { path: string; status: 'new' | 'unchanged' | 'modified' | 'blocked'; reason?: string; diff?: string }
export interface Manifest {
  target: string; dialect: string; revision: number; stagingDir: string;
  files: Array<{ path: string; kind: string }>;
  report: { notes: string[]; warnings: string[]; unsupported: string[] };
  verification: Array<{ name: string; status: string; detail: string }>;
  applied?: { written: string[]; skipped: Array<{ path: string; reason: string }> };
}

const token = document.querySelector<HTMLMetaElement>('meta[name="dba-token"]')?.content ?? '';

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, { method, headers: { 'x-dba-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; code?: string; details?: string[] };
    throw new ApiError(`${d.error ?? res.statusText}${d.details?.length ? ' — ' + d.details.slice(0, 3).join('; ') : ''}`, res.status, d.code);
  }
  return data as T;
}

export const api = {
  bundle: () => call<Bundle>('GET', 'model'),
  ops: (ops: Op[], expectedRevision: number, summary?: string) => call<{ revision: number; state: string }>('POST', 'ops', { ops, expectedRevision, summary }),
  validate: () => call<{ blocking: number; issues: Issue[] }>('POST', 'validate'),
  approve: (by: string, note?: string) => call<Status>('POST', 'approve', { by, note }),
  approveDomain: (by: string, note?: string) => call<Status>('POST', 'approve-domain', { by, note }),
  versions: () => call<Array<{ revision: number; at: string; state: string; entities: number; summary?: string }>>('GET', 'versions'),
  diff: (from?: number, to?: number) => call<Change[]>('GET', `diff?${from !== undefined ? `from=${from}&` : ''}${to !== undefined ? `to=${to}` : ''}`),
  support: () => call<{ support: SupportRow[] }>('GET', 'support'),
  generate: (target: string, dialect: string) => call<Manifest>('POST', 'generate', { target, dialect }),
  plan: (target: string, dialect: string, outDir?: string) => call<PlanItem[]>('GET', `plan?target=${target}&dialect=${dialect}${outDir ? `&outDir=${encodeURIComponent(outDir)}` : ''}`),
  apply: (target: string, dialect: string, overwrite: boolean, outDir?: string) => call<Manifest>('POST', 'apply', { target, dialect, authorize: true, overwrite, outDir }),
  saveLayout: (l: Layout) => call<{ ok: boolean }>('PUT', 'layout', l),
  scan: () => call<unknown>('POST', 'scan'),
  importScan: () => call<unknown>('POST', 'import-scan'),
  importDocs: (paths: string[]) => call<{ imported: string[]; contracts: number; skipped: Array<{ path: string; reason: string }> }>('POST', 'import-docs', { paths }),
};
