# Servidor MCP

Servidor stdio (`packages/mcp-server/bin/dbarchitect-mcp.js`, SDK oficial `@modelcontextprotocol/sdk`). Raiz autorizada: `DBARCHITECT_PROJECT_ROOT` ou o diretório atual.

| Ferramenta | Efeito |
|---|---|
| `init_session`, `get_model`, `get_pending`, `get_approval_state`, `get_diff`, `get_analysis_summary`, `get_support_matrix` | leitura / metadados |
| `inspect_project` | varredura somente leitura (grava `scan.json` nos metadados) |
| `import_scan_facts`, `import_documents`, `propose_model_ops`, `validate_model` | alteram apenas `.database-architect/` |
| `open_studio` | inicia o Studio local e devolve a URL |
| `generate_artifacts` | staging apenas; exige aprovação válida |
| `plan_apply_artifacts` | diff, não escreve |
| `apply_artifacts` | **altera o projeto**; exige `userAuthorizedWrite: true`; nunca sobrescreve migrations |

Deliberadamente **não existe** ferramenta de aprovação nem de execução arbitrária. A IA não pode afirmar `origin: "code"` sem evidência de arquivo (o motor rejeita).
Teste manual reproduzível: um cliente do SDK (`Client` + `StdioClientTransport`) iniciando `bin/dbarchitect-mcp.js` com `DBARCHITECT_PROJECT_ROOT` — foi assim que o servidor foi verificado (16 ferramentas listadas).
