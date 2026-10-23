import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { removeEntityOps, applyOps, type Attribute, type CanonicalModel, type DomainType, type Entity, type Issue } from '@dbarchitect/core';
import type { Studio } from '../store.ts';
import { Empty, Field, OriginBadge, SEVERITY_LABEL, slugify } from '../ui.tsx';

const TYPES: DomainType[] = ['string', 'text', 'integer', 'bigint', 'decimal', 'money', 'boolean', 'date', 'datetime', 'time', 'uuid', 'json', 'binary', 'enum'];
type EntityData = { entity: Entity; issues: number; match: boolean };

function EntityNode({ data, selected }: NodeProps<Node<EntityData>>) {
  const e = data.entity;
  return (
    <div className={`ent-node ${selected ? 'selected' : ''} ${data.issues ? 'has-issue' : ''}`} style={data.match ? undefined : { opacity: 0.35 }}>
      <Handle type="target" position={Position.Left} />
      <header><span>{e.kind === 'association' ? '⇄' : '▦'}</span> {e.name}{data.issues > 0 && <span className="badge sev-critical" title="Problemas">{data.issues}</span>}</header>
      {e.attributes.map((a) => (
        <div className="attr" key={a.id}><span>{a.primaryKey ? '🔑 ' : ''}{a.name}{a.nullable ? '?' : ''}</span><small>{a.domainType}</small></div>
      ))}
      {e.attributes.length === 0 && <div className="attr muted">sem atributos</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { entity: EntityNode };

export function EntitiesView({ s }: { s: Studio }) {
  return <ReactFlowProvider><Canvas s={s} /></ReactFlowProvider>;
}

function Canvas({ s }: { s: Studio }) {
  const m = s.draft!;
  const rf = useReactFlow();
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const issuesBy = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const i of s.live?.issues ?? []) { const k = i.target?.entity ?? (i.target?.kind === 'entity' ? i.target.id : undefined); if (k) map.set(k, [...(map.get(k) ?? []), i]); }
    return map;
  }, [s.live]);

  // React Flow owns node state (positions, selection); the model only feeds it. Avoids a controlled-selection feedback loop.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<EntityData>>([]);
  useEffect(() => {
    setRfNodes((prev) => m.entities.map((e, i) => {
      const old = prev.find((n) => n.id === e.id);
      return {
        id: e.id, type: 'entity', selected: old?.selected ?? false,
        position: old?.position ?? s.layout.data[e.id] ?? { x: (i % 4) * 280, y: Math.floor(i / 4) * 260 },
        data: { entity: e, issues: (issuesBy.get(e.id) ?? []).filter((x) => x.blocking).length, match: !search || e.name.toLowerCase().includes(search.toLowerCase()) },
      };
    }));
  }, [m.entities, issuesBy, search, s.layout.data, setRfNodes]);
  const selected = useMemo(() => rfNodes.filter((n) => n.selected).map((n) => n.id), [rfNodes]);
  const setSelected = useCallback((ids: string[]) => setRfNodes((ns) => ns.map((n) => ({ ...n, selected: ids.includes(n.id) }))), [setRfNodes]);

  const edges: Edge[] = useMemo(() => m.relationships.filter((r) => m.entities.some((e) => e.id === r.from.entity) && m.entities.some((e) => e.id === r.to.entity)).map((r) => ({
    id: r.id, source: r.from.entity, target: r.to.entity, label: `${r.cardinality}${r.required ? '' : ' (opc.)'}${r.onDelete === 'cascade' ? ' ⚠cascade' : ''}`, markerEnd: { type: MarkerType.ArrowClosed },
    style: r.onDelete === 'cascade' ? { stroke: 'var(--warn)' } : undefined, labelStyle: { fontSize: 11 }, animated: false,
  })), [m]);

  useEffect(() => { if (search) { const hit = m.entities.filter((e) => e.name.toLowerCase().includes(search.toLowerCase())); if (hit.length) void rf.fitView({ nodes: hit.map((h) => ({ id: h.id })), duration: 250, padding: 0.5 }); } }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const addEntity = useCallback(() => {
    const name = newName.trim(); if (!name) return;
    const id = slugify(name);
    if (m.entities.some((e) => e.id === id)) return s.say('error', `Já existe uma entidade com id ${id}.`);
    s.edit((x) => { x.entities.push({ id, name, kind: 'entity', persistence: 'persistent', attributes: [{ id: 'id', name: 'Id', domainType: 'uuid', nullable: false, domainOptional: false, primaryKey: true, generated: 'uuid', provenance: { origin: 'manual' } }], uniqueConstraints: [], checks: [], provenance: { origin: 'manual', rationale: 'Criada no Studio' } }); });
    setNewName(''); setSelected([id]);
  }, [newName, m.entities, s]);

  const deleteSelected = useCallback(() => {
    if (!selected.length) return;
    s.edit((x) => { let cur: CanonicalModel = x; for (const id of selected) cur = applyOps(cur, removeEntityOps(cur, id)); Object.assign(x, cur); });
    setSelected([]);
  }, [selected, s]);

  const connect = useCallback((c: { source: string; target: string }) => {
    const from = m.entities.find((e) => e.id === c.source); const to = m.entities.find((e) => e.id === c.target);
    if (!from || !to) return;
    const pkAttr = to.attributes.find((a) => a.primaryKey);
    if (!pkAttr) return s.say('error', `${to.name} não tem chave primária para ser referenciada.`);
    s.edit((x) => {
      const f = x.entities.find((e) => e.id === from.id)!;
      let fk = f.attributes.find((a) => a.id === `${to.id}_id`);
      if (!fk) { fk = { id: `${to.id}_id`, name: `${to.name}Id`, domainType: pkAttr.domainType, nullable: false, domainOptional: false, provenance: { origin: 'manual', rationale: `FK para ${to.name}` } }; f.attributes.push(fk); }
      const id = `${from.id}_${to.id}`;
      if (!x.relationships.some((r) => r.id === id)) x.relationships.push({ id, from: { entity: from.id, attributes: [fk.id] }, to: { entity: to.id, attributes: [pkAttr.id] }, cardinality: 'N:1', required: true, onDelete: 'restrict', provenance: { origin: 'manual', rationale: 'Criado no diagrama' } });
    });
    s.say('info', `Relacionamento ${from.name} → ${to.name} criado (N:1, obrigatório, RESTRICT). Ajuste na aba Relacionamentos.`);
  }, [m.entities, s]);

  const sel = selected.length === 1 ? m.entities.find((e) => e.id === selected[0]) : undefined;

  if (m.entities.length === 0)
    return (
      <div className="split"><div className="canvas"><div className="toolbar"><input aria-label="Nome da nova entidade" placeholder="Nova entidade (ex.: Pedido)" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntity()} /><button className="btn primary" onClick={addEntity}>+ Entidade</button></div>
        <Empty title="Nenhuma entidade ainda" hint="No modo greenfield, descreva o negócio na aba Descoberta e deixe o Claude propor o modelo, ou crie entidades manualmente aqui." /></div><aside className="panel" /></div>
    );

  return (
    <div className="split">
      <div className="canvas" role="application" aria-label="Diagrama de entidades">
        <div className="toolbar">
          <input aria-label="Buscar entidade" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input aria-label="Nome da nova entidade" placeholder="Nova entidade" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntity()} style={{ width: 130 }} />
          <button className="btn" onClick={addEntity}>+ Entidade</button>
          <button className="btn danger" disabled={!selected.length} onClick={deleteSelected}>Excluir{selected.length > 1 ? ` (${selected.length})` : ''}</button>
          <button className="btn" onClick={() => void rf.fitView({ duration: 250 })}>Centralizar</button>
        </div>
        <ReactFlow nodes={rfNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView minZoom={0.2} onConnect={connect} deleteKeyCode={null} multiSelectionKeyCode="Shift" selectionKeyCode="Shift"
          onNodeDragStop={(_, __, all) => s.saveLayout({ ...s.layout, data: { ...s.layout.data, ...Object.fromEntries(all.map((n) => [n.id, n.position])) } })}>
          <Background /><Controls /><MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <aside className="panel" aria-label="Propriedades">
        <Field label="Entidade (também navegável por teclado)">
          <select aria-label="Selecionar entidade" value={sel?.id ?? ''} onChange={(e) => setSelected(e.target.value ? [e.target.value] : [])}><option value="">—</option>{m.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        </Field>
        {selected.length > 1 && <p className="muted">{selected.length} entidades selecionadas. Excluir remove também seus relacionamentos e índices.</p>}
        {sel ? <EntityPanel e={sel} s={s} issues={issuesBy.get(sel.id) ?? []} /> : selected.length === 0 && <p className="muted">Selecione uma entidade para ver propriedades, justificativas e problemas. Arraste do ponto direito de uma entidade ao esquerdo de outra para criar um relacionamento.</p>}
      </aside>
    </div>
  );
}

function EntityPanel({ e, s, issues }: { e: Entity; s: Studio; issues: Issue[] }) {
  const setE = (fn: (x: Entity) => void) => s.edit((m) => fn(m.entities.find((y) => y.id === e.id)!));
  const setA = (id: string, fn: (a: Attribute) => void) => setE((x) => fn(x.attributes.find((a) => a.id === id)!));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <h3>{e.name} <OriginBadge p={e.provenance} /></h3>
      <Field label="Nome de domínio"><input value={e.name} onChange={(ev) => setE((x) => { x.name = ev.target.value; })} /></Field>
      <Field label="Tabela física (vazio = pela convenção)"><input value={e.table ?? ''} onChange={(ev) => setE((x) => { if (ev.target.value) x.table = ev.target.value; else delete x.table; })} /></Field>
      <Field label="Descrição / responsabilidade"><textarea value={e.description ?? ''} onChange={(ev) => setE((x) => { x.description = ev.target.value; })} /></Field>
      {e.provenance.rationale && <p className="muted">Justificativa: {e.provenance.rationale}</p>}
      {e.provenance.evidence?.map((ev, i) => <p key={i} className="muted">Evidência: {ev.file}{ev.line ? `:${ev.line}` : ''} {ev.excerpt ? `— ${ev.excerpt}` : ''}</p>)}
      <h3 style={{ marginTop: 14 }}>Atributos</h3>
      <table><tbody>
        {e.attributes.map((a) => (
          <tr key={a.id}><td colSpan={2}>
            <div className="row">
              <input aria-label={`Nome do atributo ${a.name}`} value={a.name} onChange={(ev) => setA(a.id, (x) => { x.name = ev.target.value; })} style={{ width: 110 }} />
              <select aria-label={`Tipo de ${a.name}`} value={a.domainType} onChange={(ev) => setA(a.id, (x) => { x.domainType = ev.target.value as DomainType; })} style={{ width: 90 }}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              <label className="row" style={{ margin: 0 }}><input type="checkbox" checked={a.primaryKey ?? false} onChange={(ev) => setA(a.id, (x) => { x.primaryKey = ev.target.checked; if (ev.target.checked) x.nullable = false; })} style={{ width: 'auto' }} />PK</label>
              <label className="row" style={{ margin: 0 }}><input type="checkbox" checked={a.nullable} onChange={(ev) => setA(a.id, (x) => { x.nullable = ev.target.checked; })} style={{ width: 'auto' }} />NULL</label>
              <button className="btn small" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>⋯</button>
              <button className="btn small danger" aria-label={`Remover ${a.name}`} onClick={() => setE((x) => { x.attributes = x.attributes.filter((y) => y.id !== a.id); })}>✕</button>
            </div>
            {open === a.id && <AttrDetail a={a} setA={(fn) => setA(a.id, fn)} />}
          </td></tr>
        ))}
      </tbody></table>
      <button className="btn small" onClick={() => setE((x) => { let n = x.attributes.length + 1; while (x.attributes.some((a) => a.id === `attr_${n}`)) n++; x.attributes.push({ id: `attr_${n}`, name: `Atributo${n}`, domainType: 'string', length: 100, nullable: false, domainOptional: false, provenance: { origin: 'manual' } }); })}>+ Atributo</button>
      <h3 style={{ marginTop: 14 }}>Problemas ({issues.length})</h3>
      {issues.length === 0 && <p className="muted">Nenhum problema nesta entidade.</p>}
      {issues.map((i) => <div key={i.id} className={`issue sev-${i.severity}`}><b>{SEVERITY_LABEL[i.severity]}</b><p>{i.message}</p><p className="muted">→ {i.recommendation}</p></div>)}
    </>
  );
}

function AttrDetail({ a, setA }: { a: Attribute; setA: (fn: (x: Attribute) => void) => void }) {
  return (
    <div style={{ padding: '8px 0' }}>
      <OriginBadge p={a.provenance} />
      {a.provenance.rationale && <p className="muted">Justificativa: {a.provenance.rationale}</p>}
      {a.provenance.evidence?.map((ev, i) => <p key={i} className="muted">Evidência: {ev.file}{ev.line ? `:${ev.line}` : ''} {ev.excerpt ? `— ${ev.excerpt}` : ''}</p>)}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Comprimento"><input type="number" value={a.length ?? ''} onChange={(ev) => setA((x) => { if (ev.target.value) x.length = Number(ev.target.value); else delete x.length; })} /></Field>
        <Field label="Precisão,escala"><div className="row"><input type="number" aria-label="Precisão" value={a.precision ?? ''} onChange={(ev) => setA((x) => { if (ev.target.value) x.precision = Number(ev.target.value); else delete x.precision; })} /><input type="number" aria-label="Escala" value={a.scale ?? ''} onChange={(ev) => setA((x) => { if (ev.target.value) x.scale = Number(ev.target.value); else delete x.scale; })} /></div></Field>
      </div>
      <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={a.unique ?? false} onChange={(ev) => setA((x) => { x.unique = ev.target.checked; })} />Único</label>
      <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={a.domainOptional} onChange={(ev) => setA((x) => { x.domainOptional = ev.target.checked; })} />Opcional no domínio (independente de ser NULL na coluna)</label>
      <Field label="Obrigatório quando (condição de negócio)"><input value={a.requiredWhen?.[0]?.condition ?? ''} placeholder="status = 'DELIVERED'" onChange={(ev) => setA((x) => { if (ev.target.value) x.requiredWhen = [{ condition: ev.target.value }]; else delete x.requiredWhen; })} /></Field>
      <Field label="Fonte da verdade"><input value={a.sourceOfTruth ?? ''} placeholder="internal | external:ifood" onChange={(ev) => setA((x) => { if (ev.target.value) x.sourceOfTruth = ev.target.value; else delete x.sourceOfTruth; })} /></Field>
    </div>
  );
}
