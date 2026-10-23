# Desenvolvimento local

```bash
pnpm install
pnpm test            # vitest (core, validadores, engine, geração, cenários greenfield)
pnpm typecheck       # tsc (pacotes) + tsc (Studio)
pnpm lint            # eslint
pnpm --filter @dbarchitect/studio build
pnpm check           # lint + typecheck + test + build
```

## Estrutura
- `packages/core` — tipos do CSM, JSON Schema, máquina de estados, ops, diff, store (`@dbarchitect/core` é seguro para navegador; `@dbarchitect/core/node` tem hash/fs).
- `packages/validators` — regras determinísticas por categoria (sem IA).
- `packages/project-scanner` — varredura segura e relatório de cobertura.
- `adapters/*` — analisadores (dotnet, nodejs, contracts) e geradores/dialetos (sql, prisma, ef-core, dapper).
- `packages/engine` — fachada `Engine` (sessão, scan, import, validar, aprovar, gerar, aplicar).
- `packages/cli` — `dbarchitect` + servidor HTTP local do Studio.
- `packages/mcp-server` — servidor MCP (stdio).
- `apps/studio` — React + Vite + React Flow.

Node ≥ 22.18 executa os `.ts` diretamente; não há etapa de build para CLI/engine/MCP, apenas para o Studio.
Desenvolvimento do Studio com HMR: `dbarchitect open <pasta> --port 4310 --no-open` + `pnpm --filter @dbarchitect/studio dev` (proxy `/api`; o token só é injetado na página servida pelo CLI — para HMR use a página servida e recarregue após `build`).
