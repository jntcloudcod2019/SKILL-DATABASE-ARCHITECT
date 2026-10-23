# Fluxo Greenfield (projeto novo)

Não há código. Comece pelo negócio.

1. `init_session {mode: "greenfield", description: "<texto do usuário, nas palavras dele>"}`.
2. **Descoberta** — extraia e grave via `propose_model_ops` (origin `user` para o que o usuário disse; `ai` para o que você inferiu):
   - `domain.actors`, `domain.requirements`, `domain.glossary`, `domain.concepts` (kind: entity | value-object | event | actor | external | process), `domain.rules`, `domain.lifecycles` (estados/transições), `domain.events`, `domain.contexts`.
   - Integrações externas como conceitos `external` + contratos (`import_documents` para OpenAPI/JSON Schema).
   - Para cada conceito candidato, preencha `persistenceRationale` ou marque por que **não** persiste.
3. **Entrevista**: registre perguntas em `questions` por impacto. Faça ao usuário só as 3–5 mais críticas; o resto fica `open` sem bloquear (apenas `impact: critical` bloqueia). Hipótese explícita + consequências quando seguir sem resposta.
4. `open_studio` → peça revisão do **domínio** (aba Domínio). A aprovação de domínio é feita pelo usuário.
5. **Modelo lógico**: proponha `entities`, `relationships`, `indexes`, `enums`, `conventions`. Traduza conceitos → entidades via `concept.mapsToEntity`. Explique decisões em `decisions`.
6. **Perfil físico** só depois da revisão lógica: banco, persistência, convenções, estratégia de PK, migrations. Ofereça opções com trade-offs; registre `project.profile` com `confirmed: true` apenas após a escolha explícita.
7. `validate_model` → corrigir → `open_studio` → aprovação humana → geração.

Nada é gerado como consequência da aprovação do banco além dos artefatos de persistência escolhidos. Código de domínio/API/serviços é um escopo separado e explícito.
