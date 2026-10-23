import type { Studio } from '../store.ts';
import { STATE_STEPS } from '../ui.tsx';

export function Overview({ s }: { s: Studio }) {
  const { bundle, draft } = s;
  const by = s.approver;
  const setBy = s.setApprover;
  if (!bundle || !draft) return null;
  const st = bundle.status;
  return (
    <>
      <div className="card">
        <h2>Fluxo de modelagem</h2>
        <div className="steps">{STATE_STEPS.map((x) => <span key={x} className={x === st.state ? 'on' : ''}>{x}</span>)}</div>
        <p className="muted">A geração só é possível a partir de <b>APPROVED</b>, vinculada ao hash exato da versão. Qualquer alteração invalida a aprovação.</p>
      </div>
      <div className="card">
        <h2>Sessão</h2>
        <div className="grid">
          <div className="stat"><b>{st.counts.entities}</b>Entidades</div>
          <div className="stat"><b>{st.counts.relationships}</b>Relacionamentos</div>
          <div className="stat"><b>{st.counts.concepts}</b>Conceitos de domínio</div>
          <div className="stat"><b>{st.counts.contracts}</b>Contratos externos</div>
          <div className="stat"><b>{st.pending.questions}</b>Perguntas abertas ({st.pending.critical} críticas)</div>
          <div className="stat"><b>{st.pending.hypotheses}</b>Hipóteses</div>
        </div>
        <p className="muted">Modo: <b>{draft.project.mode}</b> · hash <code>{st.hash.slice(0, 16)}…</code> · Tecnologias: {[...draft.project.languages, ...draft.project.frameworks, draft.project.orm, draft.project.database].filter(Boolean).join(', ') || 'nenhuma detectada (greenfield não escolhe tecnologia silenciosamente)'}</p>
      </div>
      <div className="card">
        <h2>Como iniciar</h2>
        <div className="grid">
          <div className="stat"><b>Novo projeto</b><span className="muted">Pasta vazia: <code>dbarchitect open ./novo --mode greenfield</code>. Use a aba Descoberta.</span></div>
          <div className="stat"><b>Projeto existente</b><span className="muted"><code>dbarchitect analyze .</code> reconstrói o modelo a partir do código, com evidências.</span></div>
          <div className="stat"><b>Nova funcionalidade</b><span className="muted"><code>dbarchitect open . --mode evolution</code>; o baseline mostra só o que muda.</span></div>
        </div>
      </div>
      <div className="card">
        <h2>Aprovação</h2>
        {st.approval ? <p>✔ Versão atual aprovada por <b>{st.approval.approvedBy}</b> (revisão {st.approval.revision}). Já é possível gerar artefatos.</p>
          : <p className="muted">Nenhuma aprovação válida para esta versão. {st.lastValidation ? `Última validação: ${st.lastValidation.blocking} bloqueante(s).` : 'Valide o modelo primeiro.'}</p>}
        <div className="row">
          <input aria-label="Nome do aprovador" placeholder="Seu nome (obrigatório)" value={by} onChange={(e) => setBy(e.target.value)} style={{ maxWidth: 240 }} />
          <button className="btn" disabled={!by.trim() || !!s.busy} onClick={() => void s.approveDomain(by)}>Aprovar domínio {st.domainApproved ? '✔' : ''}</button>
          <button className="btn primary" disabled={!by.trim() || !!s.busy} onClick={() => void s.approve(by)}>Aprovar modelo</button>
        </div>
        {!by.trim() && <p className="sev-warning">Digite seu nome no campo acima para habilitar os botões de aprovação — a aprovação é registrada em nome de uma pessoa.</p>}
        {by.trim() && !st.approval && <p className="muted">Ao clicar em “Aprovar modelo”, o Studio salva as alterações pendentes, valida a versão atual e aprova se não houver problemas bloqueantes. Se houver, o motivo aparece em um aviso vermelho que fica na tela até você fechá-lo.{s.dirty ? ' Há alterações não salvas: elas serão salvas antes.' : ''}</p>}
      </div>
    </>
  );
}
