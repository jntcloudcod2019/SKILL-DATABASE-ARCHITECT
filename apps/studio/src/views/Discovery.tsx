import { useState } from 'react';
import type { Provenance, Question } from '@dbarchitect/core';
import { api } from '../api.ts';
import type { Studio } from '../store.ts';
import { Empty, OriginBadge, newId, slugify } from '../ui.tsx';

const user: Provenance = { origin: 'user' };
type Tab = 'problem' | 'actors' | 'glossary' | 'rules' | 'questions' | 'hypotheses' | 'docs';
const TABS: Array<[Tab, string]> = [['problem', 'Problema'], ['actors', 'Atores'], ['glossary', 'Glossário'], ['rules', 'Regras de negócio'], ['questions', 'Perguntas'], ['hypotheses', 'Hipóteses'], ['docs', 'Documentos']];

export function Discovery({ s }: { s: Studio }) {
  const [tab, setTab] = useState<Tab>('problem');
  const [text, setText] = useState('');
  const [text2, setText2] = useState('');
  const [paths, setPaths] = useState('');
  const m = s.draft!;
  const add = (fn: () => void) => { if (!text.trim()) return; fn(); setText(''); setText2(''); };
  return (
    <>
      <div className="tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'problem' && (
        <div className="card">
          <h2>Descreva o sistema em linguagem natural</h2>
          <p className="muted">Não é preciso ter código nem documentação. O Claude usa esta descrição para investigar o negócio antes de propor qualquer tabela.</p>
          <textarea aria-label="Descrição do problema" value={m.domain.problem ?? ''} onChange={(e) => s.edit((x) => { x.domain.problem = e.target.value; })} />
          <label>Objetivos (um por linha)</label>
          <textarea value={m.domain.goals.join('\n')} onChange={(e) => s.edit((x) => { x.domain.goals = e.target.value.split('\n').filter(Boolean); })} />
          <p className="muted">Origem: <span className="badge o-user">👤 Informado pelo usuário</span> · Salve o rascunho para persistir.</p>
        </div>
      )}
      {tab === 'actors' && (
        <div className="card"><h2>Perfis de usuário / atores</h2>
          <div className="row"><input aria-label="Novo ator" placeholder="Ex.: Atendente do restaurante" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 360 }} />
            <button className="btn" onClick={() => add(() => s.edit((x) => { x.domain.actors.push({ id: `actor_${slugify(text)}`, name: text.trim(), provenance: user }); }))}>Adicionar</button></div>
          {m.domain.actors.length === 0 ? <Empty title="Nenhum ator ainda" /> : <table><tbody>{m.domain.actors.map((a) => <tr key={a.id}><td>{a.name}</td><td><OriginBadge p={a.provenance} /></td><td><button className="btn small danger" onClick={() => s.edit((x) => { x.domain.actors = x.domain.actors.filter((y) => y.id !== a.id); })}>Remover</button></td></tr>)}</tbody></table>}
        </div>
      )}
      {tab === 'glossary' && (
        <div className="card"><h2>Glossário</h2>
          <div className="row"><input aria-label="Termo" placeholder="Termo" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 200 }} /><input aria-label="Definição" placeholder="Definição" value={text2} onChange={(e) => setText2(e.target.value)} style={{ maxWidth: 420 }} />
            <button className="btn" onClick={() => add(() => s.edit((x) => { x.domain.glossary.push({ id: `term_${slugify(text)}`, term: text.trim(), definition: text2.trim(), provenance: user }); }))}>Adicionar</button></div>
          {m.domain.glossary.length === 0 ? <Empty title="Glossário vazio" hint="Registre os termos do negócio com as definições dos próprios usuários." /> :
            <table><thead><tr><th>Termo</th><th>Definição</th><th>Origem</th><th /></tr></thead><tbody>{m.domain.glossary.map((g) => <tr key={g.id}><td><b>{g.term}</b></td><td><input value={g.definition} aria-label={`Definição de ${g.term}`} onChange={(e) => s.edit((x) => { x.domain.glossary.find((y) => y.id === g.id)!.definition = e.target.value; })} /></td><td><OriginBadge p={g.provenance} /></td><td><button className="btn small danger" onClick={() => s.edit((x) => { x.domain.glossary = x.domain.glossary.filter((y) => y.id !== g.id); })}>Remover</button></td></tr>)}</tbody></table>}
        </div>
      )}
      {tab === 'rules' && (
        <div className="card"><h2>Regras de negócio</h2>
          <div className="row"><input aria-label="Nova regra" placeholder="Ex.: Um pedido só pode ser cancelado antes de DISPATCHED" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 520 }} />
            <button className="btn" onClick={() => add(() => s.edit((x) => { x.domain.rules.push({ id: newId('rule', x.domain.rules.map((r) => r.id)), text: text.trim(), kind: 'invariant', status: 'confirmed', provenance: user }); }))}>Registrar (confirmada)</button></div>
          {m.domain.rules.length === 0 ? <Empty title="Sem regras registradas" /> :
            <table><tbody>{m.domain.rules.map((r) => <tr key={r.id}><td>{r.text}</td><td><select aria-label="Status da regra" value={r.status} onChange={(e) => s.edit((x) => { x.domain.rules.find((y) => y.id === r.id)!.status = e.target.value as typeof r.status; })}><option value="confirmed">confirmada</option><option value="proposed">proposta</option><option value="question">em dúvida</option></select></td><td><OriginBadge p={r.provenance} /></td><td><button className="btn small danger" onClick={() => s.edit((x) => { x.domain.rules = x.domain.rules.filter((y) => y.id !== r.id); })}>Remover</button></td></tr>)}</tbody></table>}
        </div>
      )}
      {tab === 'questions' && (
        <div className="card"><h2>Perguntas e decisões</h2>
          <p className="muted">Perguntas críticas abertas bloqueiam a aprovação. Responda parcialmente; adie o que não afeta a estrutura.</p>
          <div className="row"><input aria-label="Nova pergunta" placeholder="Nova pergunta" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 520 }} />
            <button className="btn" onClick={() => add(() => s.edit((x) => { x.questions.push({ id: newId('q', x.questions.map((q) => q.id)), text: text.trim(), impact: 'medium', status: 'open', provenance: user }); }))}>Adicionar</button></div>
          {m.questions.length === 0 ? <Empty title="Sem perguntas" /> : m.questions.map((q) => <QuestionRow key={q.id} q={q} s={s} />)}
        </div>
      )}
      {tab === 'hypotheses' && (
        <div className="card"><h2>Hipóteses não confirmadas</h2>
          {m.hypotheses.length === 0 ? <Empty title="Nenhuma hipótese" hint="Quando uma regra não puder ser confirmada, o Claude registra uma hipótese com suas consequências." /> :
            <table><tbody>{m.hypotheses.map((h) => <tr key={h.id}><td><b>{h.statement}</b>{h.consequences && <div className="muted">Consequências: {h.consequences}</div>}</td><td><OriginBadge p={h.provenance} /></td>
              <td><select aria-label="Status da hipótese" value={h.status} onChange={(e) => s.edit((x) => { x.hypotheses.find((y) => y.id === h.id)!.status = e.target.value as typeof h.status; })}><option value="unconfirmed">não confirmada</option><option value="confirmed">confirmada</option><option value="rejected">rejeitada</option></select></td></tr>)}</tbody></table>}
        </div>
      )}
      {tab === 'docs' && (
        <div className="card"><h2>Importar documentos e contratos</h2>
          <p className="muted">Caminhos relativos à pasta do projeto (Markdown, OpenAPI, JSON Schema). Contratos são registrados como contratos — <b>não</b> viram tabelas automaticamente. Arquivos secretos e fora da pasta são recusados.</p>
          <textarea aria-label="Caminhos" placeholder={'docs/requisitos.md\nintegracoes/ifood.openapi.yaml'} value={paths} onChange={(e) => setPaths(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={!paths.trim() || s.dirty} onClick={async () => { const r = await s.run('Importando…', () => api.importDocs(paths.split('\n').map((p) => p.trim()).filter(Boolean))); if (r) { s.say(r.skipped.length ? 'error' : 'ok', `Importados: ${r.imported.length}, contratos: ${r.contracts}${r.skipped.length ? ` · recusados: ${r.skipped.map((x) => `${x.path} (${x.reason})`).join('; ')}` : ''}`); await s.reload(); } }}>Importar</button>{s.dirty && <span className="muted">Salve o rascunho antes.</span>}</div>
          <h3 style={{ marginTop: 16 }}>Fontes registradas</h3>
          {m.sources.length === 0 ? <Empty title="Nenhuma fonte" /> : <table><tbody>{m.sources.map((x) => <tr key={x.id}><td><span className="badge o-document">{x.kind}</span></td><td>{x.title}</td><td className="muted">{x.path}</td></tr>)}</tbody></table>}
        </div>
      )}
    </>
  );
}

function QuestionRow({ q, s }: { q: Question; s: Studio }) {
  const set = (fn: (y: Question) => void) => s.edit((x) => fn(x.questions.find((y) => y.id === q.id)!));
  return (
    <div className="issue sev-pending-decision">
      <div className="row"><b>{q.text}</b><span className={`badge ${q.impact === 'critical' ? 'sev-critical' : 'sev-suggestion'}`}>{q.impact}</span><OriginBadge p={q.provenance} />
        <select aria-label="Status" value={q.status} onChange={(e) => set((y) => { y.status = e.target.value as Question['status']; })}><option value="open">aberta</option><option value="answered">respondida</option><option value="deferred">adiada</option></select></div>
      {q.options && <div className="muted">Opções: {q.options.join(' · ')}</div>}
      {q.consequences && <div className="muted">Impacto: {q.consequences}</div>}
      {q.conflicts?.map((c, i) => <div key={i} className="muted">Fonte em conflito: {c.file}{c.line ? `:${c.line}` : ''}</div>)}
      <input aria-label="Resposta" placeholder="Resposta (registra como informação do usuário)" value={q.answer ?? ''} onChange={(e) => set((y) => { y.answer = e.target.value; if (e.target.value && y.status === 'open') y.status = 'answered'; })} />
    </div>
  );
}
