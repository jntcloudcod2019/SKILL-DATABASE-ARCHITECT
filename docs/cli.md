# CLI `dbarchitect`

`dbarchitect --help` lista tudo. Todos os comandos abaixo estão implementados.

| Comando | O que faz |
|---|---|
| `init [dir] --mode --name --description` | cria `.database-architect/` (nenhuma entidade/ORM) |
| `open|studio [dir] --mode --port --no-open` | cria/retoma a sessão e serve o Studio em 127.0.0.1 |
| `status [dir] [--json]` | estado, pendências, aprovação |
| `scan [dir]` / `analyze [dir]` | varre o código / varre e importa fatos (`analyze --reimport` reconstrói a partir do scan atual, preservando o que usuário/IA adicionaram; recusa se algo apontar para entidades do código) |
| `import-docs <arquivos…>` | registra documentos e contratos |
| `validate [dir|model.json]` | validadores; com `.json` valida schema + regras sem sessão |
| `diff [dir] --from --to` | diferenças com risco |
| `approve [dir] --by` | aprovação humana da versão atual |
| `generate --target sql|prisma|ef-core|dapper --dialect …` | gera em staging |
| `plan-apply` | diff do que seria gravado |
| `apply --yes-write [--overwrite] [--out dir]` | grava no projeto |
| `export [dir] <arq>` / `import <arq> [dir]` | exporta/importa o modelo (aprovações importadas são invalidadas) |
| `fixes [dir]` / `fix <issueId> <fixId>` | lista / aplica correções sugeridas pelos validadores (`--all-rule <regra> --fix <id>` para lote) |
| `support` | matriz real alvo × dialeto |

Códigos de saída: 0 ok, 1 achados bloqueantes/uso, 2 erro, 3 bloqueado por aprovação/autorização.
