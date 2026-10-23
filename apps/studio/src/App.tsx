import { useState } from 'react';
import { useStudio, type Studio } from './store.ts';
import { Overview } from './views/Overview.tsx';
import { Discovery } from './views/Discovery.tsx';
import { DomainView } from './views/DomainView.tsx';
import { EntitiesView } from './views/EntitiesView.tsx';
import { RelationshipsView } from './views/RelationshipsView.tsx';
import { ContractsView } from './views/ContractsView.tsx';
import { ValidationView, PerformanceView } from './views/ValidationView.tsx';
import { VersionsView } from './views/VersionsView.tsx';
import { GenerationView } from './views/GenerationView.tsx';

const NAV = [
  ['overview', 'Visão geral'], ['discovery', 'Descoberta'], ['domain', 'Domínio'], ['entities', 'Entidades'], ['relationships', 'Relacionamentos'],
  ['contracts', 'Contratos externos'], ['validation', 'Validação'], ['performance', 'Performance'], ['versions', 'Histórico de versões'], ['generation', 'Geração de artefatos'],
] as const;
type Page = (typeof NAV)[number][0];

function View({ page, s }: { page: Page; s: Studio }) {
  switch (page) {
    case 'overview': return <Overview s={s} />;
    case 'discovery': return <Discovery s={s} />;
    case 'domain': return <DomainView s={s} />;
    case 'entities': return <EntitiesView s={s} />;
    case 'relationships': return <RelationshipsView s={s} />;
    case 'contracts': return <ContractsView s={s} />;
    case 'validation': return <ValidationView s={s} />;
    case 'performance': return <PerformanceView s={s} />;
    case 'versions': return <VersionsView s={s} />;
    case 'generation': return <GenerationView s={s} />;
  }
}

export function App() {
  const s = useStudio();
  const [page, setPage] = useState<Page>('overview');
  if (s.fatal) return <div className="main"><div className="card"><h2>Não foi possível carregar a sessão</h2><p>{s.fatal}</p><p className="muted">Abra o Studio pelo comando <code>dbarchitect open &lt;pasta&gt;</code>.</p></div></div>;
  if (!s.bundle || !s.draft) return <div className="main muted">Carregando…</div>;
  const st = s.bundle.status;
  const blocking = s.live?.blocking ?? 0;
  return (
    <div className="app">
      <header className="topbar">
        <h1>Database Architect Studio</h1>
        <span className="muted">{st.project} · {st.mode}</span>
        <span className={`state-pill state-${st.state}`} title="Estado do fluxo">● {st.state}</span>
        <span className="muted">rev {st.revision}{s.dirty ? ' · alterações não salvas' : ''}</span>
        <span className="spacer" />
        {s.busy && <span className="muted" role="status">{s.busy}</span>}
        <button className="btn" onClick={s.undo} disabled={!s.canUndo} title="Desfazer">↶</button>
        <button className="btn" onClick={s.redo} disabled={!s.canRedo} title="Refazer">↷</button>
        <button className="btn" onClick={() => void s.save()} disabled={!s.dirty || !!s.busy}>Salvar rascunho</button>
        <button className="btn" onClick={() => void s.validate()} disabled={!!s.busy}>Validar</button>
      </header>
      <nav className="nav" aria-label="Seções">
        {NAV.map(([id, label]) => (
          <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
            {label}
            {id === 'validation' && blocking > 0 && <span className="badge sev-critical">{blocking}</span>}
            {id === 'discovery' && st.pending.questions > 0 && <span className="badge sev-pending-decision">{st.pending.questions}</span>}
          </button>
        ))}
      </nav>
      <main className={`main ${page === 'entities' || page === 'domain' ? 'flush' : ''}`}><View page={page} s={s} /></main>
      {s.toast && <div className={`toast ${s.toast.kind}`} role="status" onClick={() => s.setToast(null)}>{s.toast.text}</div>}
    </div>
  );
}
