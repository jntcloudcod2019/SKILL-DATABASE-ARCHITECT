import { useState } from 'react';
import type { ContractMapping } from '@dbarchitect/core';
import type { Studio } from '../store.ts';
import { Empty, OriginBadge, slugify } from '../ui.tsx';

export function ContractsView({ s }: { s: Studio }) {
  const m = s.draft!;
  const [sel, setSel] = useState<string>(m.contracts[0]?.id ?? '');
  const c = m.contracts.find((x) => x.id === sel) ?? m.contracts[0];
  if (!c) return <Empty title="Nenhum contrato externo" hint="Importe OpenAPI ou JSON Schema na aba Descoberta → Documentos. Campos de contrato não viram colunas automaticamente." />;
  const mapOf = (path: string) => m.mappings.find((x) => x.contract === c.id && x.field === path);
  const setMap = (path: string, fn: (x: ContractMapping) => void) => s.edit((d) => {
    let x = d.mappings.find((y) => y.contract === c.id && y.field === path);
    if (!x) { x = { id: `map_${slugify(c.id)}_${slugify(path)}`.slice(0, 110), contract: c.id, field: path, treatment: 'ignored', provenance: { origin: 'manual' } }; d.mappings.push(x); }
    fn(x);
  });
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><select aria-label="Contrato" value={c.id} onChange={(e) => setSel(e.target.value)} style={{ maxWidth: 420 }}>{m.contracts.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.system}</option>)}</select><OriginBadge p={c.provenance} /><span className="muted">{c.kind} · {c.direction}{c.usage ? ` · usado em ${c.usage.join('/')}` : ''}</span></div>
      <div className="card">
        <h2>{c.name}</h2>
        <p className="muted">Obrigatório na requisição ≠ obrigatório na resposta ≠ NOT NULL. Decida o tratamento de cada campo explicitamente.</p>
        <table>
          <thead><tr><th>Campo</th><th>Tipo</th><th>Requisição</th><th>Resposta</th><th>null</th><th>Tratamento</th><th>Destino</th></tr></thead>
          <tbody>{c.fields.map((f) => {
            const mp = mapOf(f.path);
            const ent = m.entities.find((e) => e.id === mp?.entity);
            return (
              <tr key={f.path}>
                <td><code>{f.path}</code></td><td>{f.type}{f.format ? `:${f.format}` : ''}</td>
                <td>{f.requiredInRequest === undefined ? '—' : f.requiredInRequest ? 'obrigatório' : 'opcional'}</td>
                <td>{f.requiredInResponse === undefined ? '—' : f.requiredInResponse ? 'garantido' : 'opcional'}</td>
                <td>{f.nullable ? 'sim' : 'não'}</td>
                <td><select aria-label={`Tratamento de ${f.path}`} value={mp ? mp.treatment : ''} onChange={(e) => e.target.value && setMap(f.path, (x) => { x.treatment = e.target.value as ContractMapping['treatment']; if (x.treatment !== 'stored') { delete x.entity; delete x.attribute; } })}>
                  <option value="">(não decidido)</option><option value="stored">armazenado</option><option value="derived">derivado</option><option value="ignored">ignorado</option><option value="external-reference">referência externa</option></select></td>
                <td>{mp?.treatment === 'stored' && <div className="row"><select aria-label="Entidade" value={mp.entity ?? ''} onChange={(e) => setMap(f.path, (x) => { x.entity = e.target.value || undefined; delete x.attribute; })}><option value="">entidade…</option>{m.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                  <select aria-label="Atributo" value={mp.attribute ?? ''} onChange={(e) => setMap(f.path, (x) => { x.attribute = e.target.value || undefined; })}><option value="">atributo…</option>{ent?.attributes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </>
  );
}
