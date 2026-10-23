import { useEffect, useState } from 'react';
import type { Change } from '@dbarchitect/core';
import { api } from '../api.ts';
import type { Studio } from '../store.ts';
import { Empty } from '../ui.tsx';

export function VersionsView({ s }: { s: Studio }) {
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof api.versions>>>([]);
  const [a, setA] = useState<number | ''>('');
  const [b, setB] = useState<number | ''>('');
  const [changes, setChanges] = useState<Change[] | null>(null);
  const rev = s.bundle!.model.status.revision;
  useEffect(() => { void api.versions().then(setVersions); }, [rev]);
  const compare = (from?: number, to?: number) => void s.run('Comparando…', () => api.diff(from, to)).then((r) => r && setChanges(r));
  return (
    <>
      <div className="card">
        <h2>Comparar versões</h2>
        <div className="row">
          <select aria-label="De" value={a} onChange={(e) => setA(e.target.value === '' ? '' : Number(e.target.value))}><option value="">baseline / anterior</option>{versions.map((v) => <option key={v.revision} value={v.revision}>r{v.revision}</option>)}</select>→
          <select aria-label="Para" value={b} onChange={(e) => setB(e.target.value === '' ? '' : Number(e.target.value))}><option value="">atual (r{rev})</option>{versions.map((v) => <option key={v.revision} value={v.revision}>r{v.revision}</option>)}</select>
          <button className="btn primary" onClick={() => compare(a === '' ? undefined : a, b === '' ? undefined : b)}>Comparar</button>
        </div>
        {changes && (changes.length === 0 ? <p className="muted">Sem diferenças.</p> : <table><thead><tr><th>Risco</th><th>Mudança</th><th>Por quê</th></tr></thead><tbody>{changes.map((c, i) => <tr key={i}><td className={`risk-${c.risk}`}>{c.risk}</td><td>{c.description}</td><td className="muted">{c.reason}</td></tr>)}</tbody></table>)}
      </div>
      <div className="card"><h2>Histórico</h2>
        {versions.length === 0 ? <Empty title="Sem versões" /> : <table><thead><tr><th>Rev</th><th>Quando</th><th>Estado</th><th>Entidades</th><th>Resumo</th></tr></thead><tbody>{[...versions].reverse().map((v) => <tr key={v.revision}><td>r{v.revision}</td><td>{new Date(v.at).toLocaleString()}</td><td>{v.state}</td><td>{v.entities}</td><td>{v.summary}</td></tr>)}</tbody></table>}
        <h3 style={{ marginTop: 12 }}>Aprovações</h3>
        {s.bundle!.model.approvals.length === 0 ? <p className="muted">Nenhuma.</p> : <table><tbody>{s.bundle!.model.approvals.map((x, i) => <tr key={i}><td>{x.stage}</td><td>r{x.revision}</td><td>{x.approvedBy}</td><td className="muted"><code>{x.hash.slice(0, 12)}</code></td><td>{x.invalidatedAt ? <span className="sev-warning">invalidada — o modelo mudou</span> : <span className="state-APPROVED">válida</span>}</td></tr>)}</tbody></table>}
      </div>
    </>
  );
}
