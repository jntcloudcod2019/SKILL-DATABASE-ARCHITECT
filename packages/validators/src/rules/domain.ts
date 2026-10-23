import { findEntity, type Issue } from '@dbarchitect/core';
import { issue, type Rule } from '../rule.ts';
import type { Fix } from '@dbarchitect/core';

export const pendingDecisions: Rule = {
  id: 'D001',
  category: 'domain',
  description: 'Perguntas críticas abertas, hipóteses não confirmadas e baixa confiança.',
  run(model) {
    const out: Issue[] = [];
    for (const q of model.questions) {
      if (q.status === 'answered') continue;
      const crit = q.impact === 'critical';
      if (q.status === 'deferred' && !crit) continue;
      out.push(
        issue(this, 'pending-decision', q.id, {
          message: `Decisão pendente${crit ? ' (crítica)' : ''}: ${q.text}`,
          target: { kind: 'question', id: q.id },
          evidence: q.conflicts,
          rationale: q.consequences ?? 'A resposta altera a estrutura do modelo; seguir sem ela exigiria uma suposição silenciosa.',
          recommendation: q.options?.length ? `Escolha uma opção: ${q.options.join(' | ')}.` : 'Responda à pergunta no Studio ou no Claude Code.',
          blocking: crit,
          fixes: [
            ...(q.options ?? []).map((o, i): Fix => ({ id: `answer-${i}`, label: `Decidir: ${o.length > 70 ? o.slice(0, 67) + '…' : o}`, description: `Registra a decisão "${o}" como resposta (status: respondida). Não altera entidades/relacionamentos sozinha — aplique o ajuste estrutural correspondente em seguida.`, decision: true, actions: [{ type: 'setItem', collection: 'questions', id: q.id, set: { status: 'answered', answer: o } }] })),
            ...(!crit ? [{ id: 'defer', label: 'Adiar (não bloqueia)', description: 'Marca como adiada; continua registrada no histórico.', actions: [{ type: 'setItem', collection: 'questions', id: q.id, set: { status: 'deferred' } }] } satisfies Fix] : []),
          ],
        }),
      );
    }
    for (const h of model.hypotheses)
      if (h.status === 'unconfirmed')
        out.push(
          issue(this, 'pending-decision', h.id, {
            message: `Hipótese não confirmada: ${h.statement}`,
            target: { kind: 'hypothesis', id: h.id },
            rationale: h.consequences ?? 'O modelo atual depende desta suposição.',
            recommendation: 'Confirme ou rejeite a hipótese; se rejeitada, revise os elementos relacionados.',
            blocking: false,
            fixes: [
              { id: 'confirm', label: 'Confirmar a hipótese', description: 'Marca como confirmada.', decision: true, actions: [{ type: 'setItem', collection: 'hypotheses', id: h.id, set: { status: 'confirmed' } }] },
              { id: 'reject', label: 'Rejeitar a hipótese', description: 'Marca como rejeitada; revise os elementos que dependiam dela.', decision: true, actions: [{ type: 'setItem', collection: 'hypotheses', id: h.id, set: { status: 'rejected' } }] },
            ],
          }),
        );
    for (const e of model.entities)
      if (e.provenance.confidence === 'low')
        out.push(
          issue(this, 'warning', `${e.id}:lowconf`, {
            message: `${e.name} foi proposta com baixa confiança`,
            target: { kind: 'entity', id: e.id },
            rationale: 'Há pouca evidência de que esta entidade deva ser persistida.',
            recommendation: 'Confirme a necessidade (identidade, ciclo de vida, histórico, consultas) ou remova.',
          }),
        );
    return out;
  },
};

export const domainTranslation: Rule = {
  id: 'D002',
  category: 'domain',
  description: 'Coerência entre modelo de domínio e modelo lógico.',
  run(model) {
    const out: Issue[] = [];
    for (const c of model.domain.concepts) {
      if (c.mapsToEntity && !findEntity(model, c.mapsToEntity))
        out.push(
          issue(this, 'domain', `${c.id}:map`, {
            message: `Conceito ${c.name} aponta para entidade inexistente ${c.mapsToEntity}`,
            target: { kind: 'concept', id: c.id },
            rationale: 'A tradução domínio → persistência está quebrada.',
            recommendation: 'Corrija ou remova o mapeamento.',
          }),
        );
      if (c.kind === 'entity' && !c.mapsToEntity && !c.persistenceRationale && model.entities.length)
        out.push(
          issue(this, 'suggestion', `${c.id}:untranslated`, {
            message: `Conceito ${c.name} não foi traduzido nem justificado como não persistente`,
            target: { kind: 'concept', id: c.id },
            rationale: 'Nem todo conceito vira tabela, mas a decisão deve ser explícita.',
            recommendation: 'Mapeie para uma entidade ou registre em persistenceRationale por que não é persistido.',
          }),
        );
    }
    for (const l of model.domain.lifecycles)
      for (const t of l.transitions)
        if (!l.states.includes(t.from) || !l.states.includes(t.to))
          out.push(
            issue(this, 'domain', `${l.id}:${t.from}-${t.to}`, {
              message: `Ciclo de vida de ${l.concept}: transição ${t.from} → ${t.to} usa estado inexistente`,
              target: { kind: 'lifecycle', id: l.id },
              rationale: 'Transições devem referenciar estados declarados.',
              recommendation: 'Declare o estado ou corrija a transição.',
            }),
          );
    for (const e of model.entities)
      if (e.persistence === 'persistent' && !e.provenance.rationale && !e.description && e.provenance.origin === 'ai')
        out.push(
          issue(this, 'suggestion', `${e.id}:why`, {
            message: `${e.name} não tem justificativa registrada`,
            target: { kind: 'entity', id: e.id },
            rationale: 'Entidades propostas pela IA devem justificar sua existência.',
            recommendation: 'Registre rationale ou description.',
          }),
        );
    return out;
  },
};

export const domainRules: Rule[] = [pendingDecisions, domainTranslation];
