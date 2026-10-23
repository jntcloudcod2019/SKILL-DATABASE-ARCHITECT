import { useMemo, useState } from 'react';
import type { Fix, Issue, Severity } from '@dbarchitect/core';
import type { Studio } from '../store.ts';
import { Empty, SEVERITY_LABEL, SEVERITY_ORDER } from '../ui.tsx';

function IssueCard({ i, s }: { i: Issue; s: Studio }) {
  return (
    <div className={`issue sev-${i.severity}`}>
      <div className="row"><b>{SEVERITY_LABEL[i.severity]}</b><code>{i.rule}</code>{i.blocking && <span className="badge sev-critical">bloqueia aprovação</span>}</div>
      <p>{i.message}</p>
      {i.evidence?.map((e, k) => <p key={k} className="muted">Evidência: {e.file}{e.line ? `:${e.line}` : ''} {e.excerpt ?? ''}</p>)}
      <p className="muted"><b>Por quê:</b> {i.rationale}</p>
      <p><b>Recomendação:</b> {i.recommendation}</p>
      {i.fixes && i.fixes.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b>Correções sugeridas</b>
          {i.fixes.map((f) => (
            <div key={f.id} className="row" style={{ alignItems: 'flex-start', marginTop: 6 }}>
              <button className="btn small primary" onClick={() => s.applyFixes([f])} aria-label={`Aplicar correção: ${f.label}`}>Aplicar</button>
              <div style={{ flex: 1, minWidth: 200 }}>
                {f.label} {f.decision && <span className="badge sev-pending-decision" title="Depende de uma decisão de negócio">decisão de negócio</span>}
                <div className="muted">{f.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Batch = the issue's PRIMARY suggestion (first fix) when it is mechanical, grouped by rule + fix id.
 * Secondary options (e.g. "money 18,2" on a latitude) never enter a batch: that would apply a wrong default to unrelated fields.
 */
function batches(issues: Issue[]): Array<{ key: string; rule: string; fix: Fix; fixes: Fix[]; names: string[] }> {
  const map = new Map<string, { rule: string; fix: Fix; fixes: Fix[]; names: string[] }>();
  for (const i of issues) {
    const f = i.fixes?.[0];
    if (!f || f.decision) continue;
    const key = `${i.rule}|${f.id}`;
    const g = map.get(key) ?? { rule: i.rule, fix: f, fixes: [], names: [] };
    g.fixes.push(f); g.names.push(i.message.split(/ [(:é]/)[0]); map.set(key, g);
  }
  return [...map.entries()].filter(([, g]) => g.fixes.length > 1).map(([key, g]) => ({ key, ...g }));
}

export function ValidationView({ s }: { s: Studio }) {
  const issues = s.live?.issues ?? [];
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const shown = filter === 'all' ? issues : issues.filter((i) => i.severity === filter);
  const groups = useMemo(() => batches(shown), [shown]);
  return (
    <>
      <div className="card">
        <h2>Validação determinística {s.dirty && <span className="muted">(sobre o rascunho não salvo)</span>}</h2>
        <p className="muted">Mesmas regras do motor, sem IA. {s.live?.blocking ?? 0} bloqueante(s) · {issues.length} no total.</p>
        <div className="row"><button className={`btn small ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>Todos ({issues.length})</button>
          {SEVERITY_ORDER.map((sv) => <button key={sv} className={`btn small ${filter === sv ? 'primary' : ''}`} onClick={() => setFilter(sv)}>{SEVERITY_LABEL[sv]} ({s.live?.bySeverity[sv] ?? 0})</button>)}</div>
      </div>
      {groups.length > 0 && (
        <div className="card">
          <h2>Correções em lote</h2>
          <p className="muted">Usa só a <b>sugestão principal</b> de cada problema (para precisão, inferida pelo nome do campo) quando várias coincidem. Confira os campos listados; você pode desfazer e revisar antes de salvar. Correções que dependem de decisão de negócio nunca entram em lote.</p>
          {groups.map((g) => (
            <div key={g.key} className="row" style={{ marginBottom: 6 }}>
              <button className="btn small primary" onClick={() => s.applyFixes(g.fixes)}>Aplicar a {g.fixes.length}</button>
              <span><code>{g.rule}</code> · <b>{g.fix.label}</b><span className="muted"> — {g.names.join(', ')}</span></span>
            </div>
          ))}
        </div>
      )}
      {shown.length === 0 ? <Empty title="Nenhum problema nesta categoria" /> : shown.map((i) => <IssueCard key={i.id} i={i} s={s} />)}
    </>
  );
}

export function PerformanceView({ s }: { s: Studio }) {
  const m = s.draft!;
  const perf = useMemo(() => (s.live?.issues ?? []).filter((i) => i.category === 'performance' || i.category === 'indexes'), [s.live]);
  return (
    <>
      <div className="card">
        <h2>Volume estimado por entidade</h2>
        <p className="muted">Opcional. Sem volume informado, as recomendações são condicionais — nenhum ganho de desempenho é inventado.</p>
        <table><tbody>{m.entities.filter((e) => e.persistence === 'persistent').map((e) => (
          <tr key={e.id}><td>{e.name}</td><td style={{ width: 200 }}><input type="number" aria-label={`Linhas estimadas de ${e.name}`} placeholder="linhas estimadas" value={e.estimatedRows ?? ''} onChange={(ev) => s.edit((x) => { const t = x.entities.find((y) => y.id === e.id)!; if (ev.target.value) t.estimatedRows = Number(ev.target.value); else delete t.estimatedRows; })} /></td></tr>
        ))}</tbody></table>
      </div>
      <div className="card"><h2>Consultas frequentes conhecidas</h2>
        {m.queries.length === 0 ? <p className="muted">Nenhuma consulta registrada. Informe-as ao Claude (ou importe de Dapper/SQL) para análise de índices e paginação.</p> :
          <table><thead><tr><th>Consulta</th><th>Entidade</th><th>Filtros</th><th>Ordem</th><th>Paginação</th></tr></thead><tbody>{m.queries.map((q) => <tr key={q.id}><td>{q.name}</td><td>{q.entity}</td><td>{q.filters.join(', ')}</td><td>{q.orderBy.join(', ')}</td><td>{q.pagination ?? '—'}</td></tr>)}</tbody></table>}
      </div>
      <h2>Achados de performance e índices</h2>
      {perf.length === 0 ? <Empty title="Sem achados" /> : perf.map((i) => <IssueCard key={i.id} i={i} s={s} />)}
    </>
  );
}
