import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeOps, type CanonicalModel, type Fix, type Origin } from '@dbarchitect/core';
import { applyFix, validateModel } from '@dbarchitect/validators';
import { ApiError, api, type Bundle, type Layout } from './api.ts';

export interface Toast { kind: 'ok' | 'error' | 'info'; text: string }

/**
 * UI state is separate from the persisted model: `draft` holds unsaved edits on top of `saved`.
 * Saving sends computeOps(saved, draft) to the engine, which validates the schema and bumps the revision.
 */
export function useStudio() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [draft, setDraft] = useState<CanonicalModel | null>(null);
  const [layout, setLayout] = useState<Layout>({ domain: {}, data: {} });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  // Approver name survives tab switches and reloads (per-browser convenience only; approval is still recorded server-side).
  const [approver, setApproverState] = useState<string>(() => { try { return localStorage.getItem('dba-approver') ?? ''; } catch { return ''; } });
  const setApprover = useCallback((v: string) => { setApproverState(v); try { localStorage.setItem('dba-approver', v); } catch { /* storage unavailable */ } }, []);
  const undo = useRef<CanonicalModel[]>([]);
  const redo = useRef<CanonicalModel[]>([]);
  const [, bump] = useState(0);

  const say = useCallback((kind: Toast['kind'], text: string) => setToast({ kind, text }), []);

  const load = useCallback(async () => {
    try {
      const b = await api.bundle();
      setBundle(b); setDraft(b.model); setLayout(b.layout); undo.current = []; redo.current = []; bump((x) => x + 1);
    } catch (e) { setFatal((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Errors stay until dismissed so the real reason can be read; confirmations fade.
  useEffect(() => { if (!toast || toast.kind === 'error') return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const dirty = !!bundle && !!draft && JSON.stringify(computeOps(bundle.model, draft)) !== '[]';

  /** Local edit with undo history. */
  const edit = useCallback((fn: (m: CanonicalModel) => void) => {
    setDraft((cur) => {
      if (!cur) return cur;
      undo.current.push(cur); redo.current = [];
      const next = structuredClone(cur); fn(next); return next;
    });
    bump((x) => x + 1);
  }, []);
  const doUndo = useCallback(() => setDraft((cur) => { const p = undo.current.pop(); if (!p || !cur) return cur; redo.current.push(cur); bump((x) => x + 1); return p; }), []);
  const doRedo = useCallback(() => setDraft((cur) => { const n = redo.current.pop(); if (!n || !cur) return cur; undo.current.push(cur); bump((x) => x + 1); return n; }), []);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
    setBusy(label);
    try { const r = await fn(); if (okText) say('ok', okText); return r; }
    catch (e) { say('error', e instanceof ApiError ? e.message : (e as Error).message); return undefined; }
    finally { setBusy(null); }
  }, [say]);

  /** Returns true when there is nothing left unsaved (saved now, or nothing to save). */
  const save = useCallback(async (summary = 'Edição no Studio'): Promise<boolean> => {
    if (!bundle || !draft) return false;
    const ops = computeOps(bundle.model, draft);
    if (!ops.length) { say('info', 'Nada para salvar.'); return true; }
    const r = await run('Salvando…', () => api.ops(ops, bundle.model.status.revision, summary), 'Rascunho salvo.');
    if (!r) return false;
    await load();
    return true;
  }, [bundle, draft, run, load, say]);

  // Validate/approve save pending edits first: they always apply to a saved version.
  const validate = useCallback(async () => {
    if (dirty && !(await save('Salvo antes de validar'))) return;
    const r = await run('Validando…', () => api.validate());
    if (r) { await load(); say(r.blocking ? 'error' : 'ok', r.blocking ? `${r.blocking} problema(s) bloqueante(s). Veja a aba Validação.` : 'Sem problemas bloqueantes.'); }
  }, [dirty, save, run, load, say]);

  const approve = useCallback(async (by: string, note?: string) => {
    if (dirty && !(await save('Salvo antes de aprovar'))) return;
    const r = await run('Aprovando…', () => api.approve(by, note), 'Modelo aprovado para esta versão.');
    if (r) await load();
  }, [dirty, save, run, load]);

  const approveDomain = useCallback(async (by: string) => {
    if (dirty && !(await save('Salvo antes de aprovar o domínio'))) return;
    const r = await run('Aprovando domínio…', () => api.approveDomain(by), 'Domínio aprovado.');
    if (r) await load();
  }, [dirty, save, run, load]);

  /** Applies suggested corrections to the local draft (undoable, revalidated live). Saving stays an explicit step. */
  const applyFixes = useCallback((fixes: Fix[]) => {
    if (!draft || !fixes.length) return;
    try {
      let cur = draft;
      for (const f of fixes) cur = applyFix(cur, f);
      const next = cur;
      edit((m) => { Object.assign(m, next); });
      say('ok', fixes.length === 1 ? `Correção aplicada ao rascunho: ${fixes[0].label}. Use “Salvar rascunho” para persistir (Desfazer reverte).` : `${fixes.length} correções aplicadas ao rascunho. Use “Salvar rascunho” para persistir (Desfazer reverte).`);
    } catch (e) { say('error', `Não foi possível aplicar a correção: ${(e as Error).message}`); }
  }, [draft, edit, say]);

  const saveLayout = useCallback((l: Layout) => { setLayout(l); void api.saveLayout(l).catch(() => {}); }, []);

  // Live validation on the draft (same deterministic rules the engine runs) so problems show while editing.
  const live = useMemo(() => (draft ? validateModel(draft) : null), [draft]);

  return { bundle, draft, layout, busy, toast, fatal, dirty, live, edit, undo: doUndo, redo: doRedo, canUndo: undo.current.length > 0, canRedo: redo.current.length > 0, save, validate, approve, approveDomain, applyFixes, approver, setApprover, saveLayout, reload: load, run, say, setToast };
}

export type Studio = ReturnType<typeof useStudio>;

export const ORIGIN_LABEL: Record<Origin, string> = { user: 'Usuário', document: 'Documento', code: 'Código', ai: 'Inferência IA', manual: 'Editado manualmente' };
export const ORIGIN_ICON: Record<Origin, string> = { user: '👤', document: '📄', code: '</>', ai: '✦', manual: '✎' };
