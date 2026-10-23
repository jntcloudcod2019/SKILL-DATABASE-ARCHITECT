---
name: database-architect
description: Modelagem de dados guiada por domínio com revisão visual e aprovação humana. Use para criar a arquitetura de dados de um sistema novo (sem código), analisar o banco/modelagem de um projeto existente, evoluir o schema para uma nova funcionalidade, mapear entidades a partir de contratos de API (OpenAPI/JSON Schema), revisar um modelo de domínio antes de implementar, ou comparar o modelo aprovado com alterações.
when_to_use: "Gatilhos: 'modelar banco de dados', 'criar o schema', 'quais tabelas', 'entidades e relacionamentos', 'migration segura', 'integrar API do iFood/…', 'revisar meu modelo', 'database design', 'data model for', 'evolve the schema'."
allowed-tools: mcp__database-architect__init_session mcp__database-architect__inspect_project mcp__database-architect__get_analysis_summary mcp__database-architect__import_scan_facts mcp__database-architect__import_documents mcp__database-architect__get_model mcp__database-architect__propose_model_ops mcp__database-architect__get_pending mcp__database-architect__validate_model mcp__database-architect__get_diff mcp__database-architect__open_studio mcp__database-architect__get_approval_state mcp__database-architect__get_support_matrix mcp__database-architect__generate_artifacts mcp__database-architect__plan_apply_artifacts Read Grep Glob
---

# Database Architect

Princípio: **entender o domínio → validar → aprovar visualmente → só então gerar.** Nunca gere tabelas, ORM ou migrations a partir de uma descrição resumida nem de suposições.

## Passo 0 — retomar ou iniciar
1. Chame `get_approval_state`. Se existir sessão, **retome**: leia `get_pending` e `get_model` (summary) e continue de onde parou; nunca refaça respostas já dadas.
2. Se não houver sessão, escolha o fluxo pela intenção (tabela abaixo) e chame `init_session` com o modo.

| Intenção do usuário | Modo | Leia |
|---|---|---|
| Sistema novo / pasta vazia / "quero criar…" | `greenfield` | [references/greenfield-flow.md](references/greenfield-flow.md) |
| Analisar/revisar banco e modelagem existentes | `brownfield` | [references/brownfield-flow.md](references/brownfield-flow.md) |
| Nova funcionalidade / integração / módulo em projeto existente | `evolution` | [references/evolution-flow.md](references/evolution-flow.md) |

Greenfield **não inspeciona arquivos inexistentes**: começa pela descoberta do negócio. Brownfield/evolution começam por `inspect_project` e `import_scan_facts`.

## Regras inegociáveis
- **Fatos ≠ hipóteses.** Elementos com `provenance.origin: "code"` exigem evidência com arquivo/linha (o motor rejeita o contrário). Inferências usam `"ai"` + `rationale`. O que veio do usuário usa `"user"`; de documentos, `"document"`.
- **Lacuna ⇒ pergunta ou hipótese**, nunca suposição silenciosa. Registre em `questions` (com `impact`, `options`, `consequences`) ou `hypotheses`. Priorize por impacto; no máximo 3–5 perguntas por vez ([references/interview.md](references/interview.md)).
- Nem todo substantivo vira entidade. Justifique persistência por identidade, ciclo de vida, histórico ou consulta. Domínio ≠ tabela ([references/modeling-rules.md](references/modeling-rules.md)).
- Separe: obrigatório na requisição, obrigatório na resposta, `domainOptional`, `nullable` da coluna e `requiredWhen`.
- Não escolha banco/ORM sem o usuário. Apresente opções e trade-offs; registre em `project.profile` com `confirmed: true` só após confirmação explícita.
- Todas as mudanças passam por `propose_model_ops` (formato em [references/csm-cheatsheet.md](references/csm-cheatsheet.md)). Não crie modelo paralelo.
- **Você não aprova.** Não existe ferramenta de aprovação: peça ao usuário para revisar e aprovar no Studio (`open_studio`). A aprovação vale para um hash; qualquer alteração a invalida.
- Geração: só após aprovação válida e perfil confirmado ([references/generation-safety.md](references/generation-safety.md)). `generate_artifacts` escreve só em staging. Gravar no projeto exige mostrar `plan_apply_artifacts` e a instrução explícita do usuário; nunca aplique migrations nem conecte a bancos.

## Ciclo
descobrir → propor ops → `validate_model` → corrigir/perguntar → `open_studio` → usuário edita/aprova → `get_approval_state` → `generate_artifacts` (alvo escolhido) → `plan_apply_artifacts` → revisar o diff com o usuário → relatório com evidências.

Use os subagentes `domain-analyst`, `schema-reviewer`, `performance-reviewer` e `migration-reviewer` quando a análise for independente; todos devem ler/escrever o mesmo modelo pelo MCP.
