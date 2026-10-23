<<<<<<< HEAD
# SKILL DATABASE ARCHITECT
Especialista em modelagem de dados, DBA e ORMs.
=======
# Database Architect Studio

Ferramenta externa (CLI + Studio web + servidor MCP + skill do Claude Code) que ajuda a **entender o domínio, validar o modelo de dados, aprovar visualmente e só então gerar artefatos**. Funciona em três modos sobre o mesmo núcleo, o mesmo modelo canônico (CSM) e os mesmos validadores:

| Modo | Quando | Ponto de partida |
|---|---|---|
| **greenfield** | projeto novo, pasta vazia, só requisitos/contratos | descoberta do negócio → domínio → lógico → físico |
| **brownfield** | projeto com código/migrations | scanner reconstrói o modelo com evidências |
| **evolution** | nova funcionalidade/integração | baseline do existente; só o delta é proposto e diferenciado |

Não é uma biblioteca da sua aplicação: lê apenas o diretório autorizado, não executa código do projeto, não instala dependências dele e **não conecta a bancos nem aplica migrations**.

## Requisitos
- Node.js ≥ 22.18 (executa TypeScript nativamente e usa `node:sqlite` para verificar DDL SQLite)
- pnpm ≥ 10
- Opcionais, para verificar artefatos: .NET SDK (`dotnet build`), `prisma` (`prisma validate`)

## Instalação
```bash
pnpm install
pnpm --filter @dbarchitect/studio build   # compila o Studio (apps/studio/dist)
node packages/cli/bin/dbarchitect.js --help
```
Opcional: `pnpm link --global --dir packages/cli` para ter `dbarchitect` no PATH.

## Uso rápido
```bash
# Projeto novo (pasta vazia)
dbarchitect open ./meu-projeto --mode greenfield      # cria .database-architect/ e abre o Studio em 127.0.0.1

# Projeto existente
dbarchitect analyze ./app                             # scan + importa fatos (evidências arquivo:linha)
dbarchitect open ./app

# Validar, aprovar (ato humano), gerar, revisar e só então gravar
dbarchitect validate ./app
dbarchitect approve ./app --by "Maria"
dbarchitect generate ./app --target sql --dialect sqlite
dbarchitect plan-apply ./app --target sql --dialect sqlite
dbarchitect apply ./app --target sql --dialect sqlite --yes-write
```

## Claude Code
```bash
claude plugin marketplace add "$(pwd)"
claude plugin install database-architect-studio@dbarchitect-local
```
O plugin traz a skill `database-architect`, 4 subagentes e o servidor MCP (`.mcp.json`). Detalhes: [docs/claude-code.md](docs/claude-code.md).

## Documentação
[Desenvolvimento local](docs/development.md) · [Claude Code](docs/claude-code.md) · [CLI](docs/cli.md) · [MCP](docs/mcp.md) · [Modelo canônico](docs/canonical-model.md) · [Validadores](docs/validators.md) · [Adaptadores e geradores](docs/adapters.md) · [Matriz de suporte](docs/support-matrix.md) · [ADRs](docs/adr.md) · [Roadmap](docs/roadmap.md) · [Exemplos](docs/examples.md)

## Estado real (leia antes de confiar)
Ver [docs/support-matrix.md](docs/support-matrix.md) e [docs/roadmap.md](docs/roadmap.md): o que está implementado, como cada coisa foi verificada e as limitações conhecidas.
>>>>>>> ef145a4 (init project skill database architect)
