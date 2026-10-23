# Uso no Claude Code

Formatos conferidos na documentação oficial (plugins, skills, subagents, MCP) e validados com `claude plugin validate .`.

## Instalar o plugin local
```bash
claude plugin marketplace add /caminho/para/database-architect-studio
claude plugin install database-architect-studio@dbarchitect-local
```
Ou apenas para testar: `claude --plugin-dir /caminho/para/database-architect-studio`.

Componentes: `skills/database-architect/` (SKILL.md + `references/`), `agents/*.md` (domain-analyst, schema-reviewer, performance-reviewer, migration-reviewer), `.mcp.json` (servidor `database-architect`, stdio, `DBARCHITECT_PROJECT_ROOT=${CLAUDE_PROJECT_DIR:-.}`).

## Só o MCP (sem plugin)
```bash
claude mcp add --transport stdio database-architect --env DBARCHITECT_PROJECT_ROOT="$PWD" -- node /caminho/database-architect-studio/packages/mcp-server/bin/dbarchitect-mcp.js
```

## Fluxo
1. “Quero criar um sistema de gestão de pedidos para restaurantes…” → a skill inicia **greenfield**: registra o contexto, entrevista por impacto, constrói o modelo candidato e chama `open_studio`.
2. Você revisa/edita no Studio e **aprova** (a skill não possui ferramenta de aprovação).
3. Escolha o alvo (SQL/Prisma/EF Core/Dapper) → `generate_artifacts` (staging) → diff → gravação somente com sua instrução explícita.
4. Sessões são retomáveis: o estado vive em `.database-architect/`.

O MCP restringe a leitura à raiz autorizada (a raiz é fixada na inicialização, não é argumento de ferramenta) e não expõe execução arbitrária de comandos.
