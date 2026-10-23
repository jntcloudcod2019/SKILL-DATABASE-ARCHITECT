import type { ReferentialAction, Relationship } from '@dbarchitect/core';
import type { Studio } from '../store.ts';
import { Empty, OriginBadge } from '../ui.tsx';

const ACTIONS: ReferentialAction[] = ['restrict', 'no-action', 'cascade', 'set-null', 'set-default'];

export function RelationshipsView({ s }: { s: Studio }) {
  const m = s.draft!;
  const set = (id: string, fn: (r: Relationship) => void) => s.edit((x) => fn(x.relationships.find((r) => r.id === id)!));
  const name = (id: string) => m.entities.find((e) => e.id === id)?.name ?? `⚠ ${id}`;
  if (!m.relationships.length) return <Empty title="Nenhum relacionamento" hint="Crie no diagrama de entidades arrastando de uma entidade a outra." />;
  return (
    <div className="card">
      <h2>Relacionamentos</h2>
      <p className="muted">Lido como dependente → principal. “Obrigatória” é a regra da associação; a nulabilidade da FK é do atributo e deve ser coerente.</p>
      <table>
        <thead><tr><th>Dependente → Principal</th><th>FK</th><th>Cardinalidade</th><th>Obrigatória</th><th>Identificador</th><th>ON DELETE</th><th>Origem</th><th /></tr></thead>
        <tbody>{m.relationships.map((r) => {
          const from = m.entities.find((e) => e.id === r.from.entity);
          return (
            <tr key={r.id}>
              <td><b>{name(r.from.entity)}</b> → <b>{name(r.to.entity)}</b></td>
              <td>{r.from.attributes.map((a) => { const at = from?.attributes.find((x) => x.id === a); return `${at?.name ?? a}${at?.nullable ? ' (NULL)' : ''}`; }).join(', ') || <span className="sev-modeling">ausente</span>}</td>
              <td><select aria-label="Cardinalidade" value={r.cardinality} onChange={(e) => set(r.id, (x) => { x.cardinality = e.target.value as Relationship['cardinality']; })}><option>N:1</option><option>1:1</option><option>N:N</option></select></td>
              <td><input type="checkbox" aria-label="Obrigatória" style={{ width: 'auto' }} checked={r.required} onChange={(e) => set(r.id, (x) => { x.required = e.target.checked; })} /></td>
              <td><input type="checkbox" aria-label="Identificador" style={{ width: 'auto' }} checked={r.identifying ?? false} onChange={(e) => set(r.id, (x) => { x.identifying = e.target.checked; })} /></td>
              <td><select aria-label="ON DELETE" value={r.onDelete} onChange={(e) => set(r.id, (x) => { x.onDelete = e.target.value as ReferentialAction; })}>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>{r.onDelete === 'cascade' && <div className="sev-integrity">⚠ apaga dependentes</div>}</td>
              <td><OriginBadge p={r.provenance} /></td>
              <td><button className="btn small danger" onClick={() => s.edit((x) => { x.relationships = x.relationships.filter((y) => y.id !== r.id); })}>Remover</button></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
