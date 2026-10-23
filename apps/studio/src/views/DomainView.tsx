import { useMemo, useState } from 'react';
import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react';
import type { Concept } from '@dbarchitect/core';
import type { Studio } from '../store.ts';
import { Empty, OriginBadge, slugify } from '../ui.tsx';

const KIND_LABEL: Record<Concept['kind'], string> = { entity: 'Entidade', 'value-object': 'Objeto de valor', event: 'Evento', actor: 'Ator', external: 'Externo', process: 'Processo' };

export function DomainView({ s }: { s: Studio }) {
  return <ReactFlowProvider><Inner s={s} /></ReactFlowProvider>;
}

function Inner({ s }: { s: Studio }) {
  const d = s.draft!.domain;
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const nodes: Node[] = useMemo(() => d.concepts.map((c, i) => ({
    id: c.id, position: s.layout.domain[c.id] ?? { x: (i % 4) * 240, y: Math.floor(i / 4) * 150 },
    data: { label: `${c.name} · ${KIND_LABEL[c.kind]}${c.mapsToEntity ? ' → ' + c.mapsToEntity : ''}` },
    style: { border: `1.5px ${c.kind === 'external' ? 'dashed' : 'solid'} var(--${c.provenance.origin === 'ai' ? 'o-ai' : 'border'})`, borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', padding: 8, fontSize: 12 },
  })), [d.concepts, s.layout.domain]);
  const edges: Edge[] = useMemo(() => d.conceptRelations.map((r) => ({ id: r.id, source: r.from, target: r.to, label: `${r.label}${r.multiplicity ? ` (${r.multiplicity})` : ''}`, markerEnd: { type: MarkerType.ArrowClosed } })), [d.conceptRelations]);
  const c = d.concepts.find((x) => x.id === sel);
  const setC = (fn: (x: Concept) => void) => s.edit((m) => fn(m.domain.concepts.find((y) => y.id === sel)!));
  return (
    <div className="split">
      <div className="canvas" role="application" aria-label="Diagrama de domínio">
        <div className="toolbar"><input aria-label="Novo conceito" placeholder="Novo conceito" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => { if (!name.trim()) return; const id = `c_${slugify(name)}`; s.edit((m) => { m.domain.concepts.push({ id, name: name.trim(), kind: 'entity', provenance: { origin: 'user' } }); }); setName(''); setSel(id); }}>+ Conceito</button></div>
        {d.concepts.length === 0 ? <Empty title="Sem conceitos de domínio" hint="O domínio é modelado antes das tabelas. Uma relação entre conceitos não implica FK direta." /> :
          <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, n) => setSel(n.id)}
            onConnect={(cn) => s.edit((m) => { m.domain.conceptRelations.push({ id: `rel_${cn.source}_${cn.target}_${m.domain.conceptRelations.length + 1}`, from: cn.source, to: cn.target, label: 'relaciona-se com', provenance: { origin: 'user' } }); })}
            onNodeDragStop={(_, n) => s.saveLayout({ ...s.layout, domain: { ...s.layout.domain, [n.id]: n.position } })}><Background /><Controls /></ReactFlow>}
      </div>
      <aside className="panel" aria-label="Conceito">
        <select aria-label="Selecionar conceito" value={sel ?? ''} onChange={(e) => setSel(e.target.value || null)}><option value="">—</option>{d.concepts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        {c ? (<>
          <h3>{c.name} <OriginBadge p={c.provenance} /></h3>
          <label>Tipo</label><select value={c.kind} onChange={(e) => setC((x) => { x.kind = e.target.value as Concept['kind']; })}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label>Descrição</label><textarea value={c.description ?? ''} onChange={(e) => setC((x) => { x.description = e.target.value; })} />
          <label>Justificativa de persistência (identidade, ciclo de vida, histórico, consultas)</label><textarea value={c.persistenceRationale ?? ''} onChange={(e) => setC((x) => { x.persistenceRationale = e.target.value; })} />
          <label>Traduz para a entidade</label><select value={c.mapsToEntity ?? ''} onChange={(e) => setC((x) => { if (e.target.value) x.mapsToEntity = e.target.value; else delete x.mapsToEntity; })}><option value="">(não traduzido)</option>{s.draft!.entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}</select>
          <button className="btn danger small" style={{ marginTop: 10 }} onClick={() => { s.edit((m) => { m.domain.concepts = m.domain.concepts.filter((y) => y.id !== c.id); m.domain.conceptRelations = m.domain.conceptRelations.filter((r) => r.from !== c.id && r.to !== c.id); }); setSel(null); }}>Remover conceito</button>
        </>) : <p className="muted">Selecione um conceito. Arraste entre conceitos para relacioná-los semanticamente.</p>}
        <h3 style={{ marginTop: 14 }}>Regras e ciclos de vida</h3>
        {d.rules.map((r) => <p key={r.id} className="muted">• {r.text}</p>)}
        {d.lifecycles.map((l) => <p key={l.id} className="muted">⟳ {l.concept}: {l.states.join(' → ')}</p>)}
      </aside>
    </div>
  );
}
