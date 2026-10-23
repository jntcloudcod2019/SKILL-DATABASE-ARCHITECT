import { useEffect, useState } from 'react';
import { api, type Manifest, type PlanItem, type SupportRow } from '../api.ts';
import type { Studio } from '../store.ts';
import { DiffText } from '../ui.tsx';

export function GenerationView({ s }: { s: Studio }) {
  const [support, setSupport] = useState<SupportRow[]>([]);
  const [pick, setPick] = useState('');
  const [man, setMan] = useState<Manifest | null>(null);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  // Brownfield projects already have their own folders: default to a separate folder so nothing lands in the middle of existing code.
  const [outDir, setOutDir] = useState(s.bundle!.model.project.mode === 'greenfield' ? '.' : 'generated');
  useEffect(() => { void api.support().then((r) => { setSupport(r.support); setPick(`${r.support[0]?.target}|${r.support[0]?.dialect}`); }); }, []);
  const [target, dialect] = pick.split('|');
  const st = s.bundle!.status;
  const canGenerate = !!st.approval && !s.dirty;
  return (
    <>
      <div className="card">
        <h2>1 · Gerar para staging</h2>
        <p className="muted">Exige aprovação válida da versão atual. Gera em <code>.database-architect/generated/</code>; <b>o projeto não é alterado</b>. Nenhuma migration é aplicada e nenhum banco é acessado.</p>
        {!st.approval && <p className="sev-warning">Sem aprovação válida para esta versão. Aprove o modelo na Visão geral (qualquer alteração depois de aprovar invalida a aprovação).</p>}
        {st.approval && s.dirty && <p className="sev-warning">Há alterações não salvas no rascunho. Salve e aprove novamente antes de gerar.</p>}
        <div className="row"><select aria-label="Alvo e dialeto" value={pick} onChange={(e) => { setPick(e.target.value); setMan(null); setPlan(null); }} style={{ maxWidth: 520 }}>{support.map((x) => <option key={`${x.target}|${x.dialect}`} value={`${x.target}|${x.dialect}`}>{x.target} · {x.dialect} — {x.verification}</option>)}</select>
          <button className="btn primary" disabled={!canGenerate || !!s.busy} onClick={async () => { const r = await s.run('Gerando…', () => api.generate(target, dialect), 'Artefatos gerados em staging.'); if (r) { setMan(r); setPlan(null); await s.reload(); } }}>Gerar</button></div>
        {!st.profile.confirmed && st.approval && <p className="muted">Perfil tecnológico não confirmado: o dialeto escolhido acima será usado nesta geração, mas não foi registrado como decisão do projeto.</p>}
        {man && (<><h3 style={{ marginTop: 12 }}>Resultado</h3>
          <p className="state-APPROVED">✔ Gerado em staging: <code>{man.stagingDir}</code>. <b>Nada foi gravado no seu projeto ainda.</b> Para colocar os arquivos no projeto, use os passos 2 e 3 abaixo.</p><ul>{man.files.map((f) => <li key={f.path}><code>{f.path}</code> <span className="muted">{f.kind}</span></li>)}</ul>
          {man.verification.map((v) => <p key={v.name} className={v.status === 'failed' ? 'sev-critical' : v.status === 'passed' ? 'state-APPROVED' : 'muted'}>Verificação {v.name}: <b>{v.status}</b> — {v.detail}</p>)}
          {[...man.report.warnings.map((x) => ['aviso', x]), ...man.report.unsupported.map((x) => ['não suportado', x]), ...man.report.notes.map((x) => ['nota', x])].map(([k, x], i) => <p key={i} className="muted">{k}: {x}</p>)}</>)}
      </div>
      <div className="card">
        <h2>2 · Revisar o diff no projeto</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <label style={{ margin: 0 }}>Pasta de destino no projeto</label>
          <input aria-label="Pasta de destino" value={outDir} onChange={(e) => { setOutDir(e.target.value); setPlan(null); }} style={{ maxWidth: 260 }} placeholder="ex.: src/Generated ou ." />
          <span className="muted">relativa à raiz do projeto; “.” = raiz</span>
        </div>
        <button className="btn" disabled={!man || !!s.busy} onClick={async () => { const r = await s.run('Planejando…', () => api.plan(target, dialect, outDir.trim() || '.')); if (r) setPlan(r); }}>Mostrar o que seria gravado</button>
        {!man && <span className="muted"> Primeiro gere em staging (passo 1).</span>}
        {plan?.map((p) => <div key={p.path} style={{ marginTop: 10 }}><b>{p.status.toUpperCase()}</b> <code>{p.path}</code> {p.reason && <span className="muted">({p.reason})</span>}{p.diff && <DiffText text={p.diff} />}</div>)}
      </div>
      <div className="card">
        <h2>3 · Gravar no projeto <span className="badge sev-warning">autorização separada da aprovação</span></h2>
        <p className="muted">Aprovar o modelo não autoriza alterar arquivos. Arquivos existentes só são substituídos com “sobrescrever”; migrations existentes nunca são substituídas.</p>
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />Revisei o diff e autorizo gravar estes arquivos no projeto</label>
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />Permitir sobrescrever arquivos existentes (não migrations)</label>
        <button className="btn danger" disabled={!confirm || !plan || !!s.busy} onClick={async () => { const r = await s.run('Gravando…', () => api.apply(target, dialect, overwrite, outDir.trim() || '.')); if (r?.applied) { setMan(r); s.say(r.applied.written.length ? 'ok' : 'error', `Gravados: ${r.applied.written.length}; não gravados: ${r.applied.skipped.length}${r.applied.skipped.length ? ' — veja o motivo abaixo.' : '.'}`); } }}>Gravar no projeto</button>
        {(!plan || !confirm) && <span className="muted"> {!plan ? 'Antes, mostre o que seria gravado (passo 2). ' : ''}{!confirm ? 'Marque a confirmação acima.' : ''}</span>}
        {man?.applied && <div style={{ marginTop: 8 }}><p>Gravados: {man.applied.written.join(', ') || '(nenhum)'}</p>{man.applied.skipped.map((x) => <p key={x.path} className="muted">Não gravado {x.path}: {x.reason}</p>)}</div>}
      </div>
    </>
  );
}
