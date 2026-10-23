# Referência dos validadores

Executam sem IA (`validateModel`). Severidades bloqueantes: `critical`, `modeling`; decisões `critical` abertas também bloqueiam. Lista atual: `dbarchitect` → `engine.rules()` ou `GET /api/rules`.

| Regra | Categoria | Verifica |
|---|---|---|
| S001 | structural | identificadores/tabelas/colunas duplicados |
| S002 | structural | entidade persistente sem PK |
| S003 | structural | referências inexistentes (relacionamento, unicidade, enum) |
| S004 | structural | FK ausente/aridade/tipo incompatível, N:N sem associação, 1:1 sem unicidade, destino não-chave |
| S005 | structural | nulabilidade contraditória (PK nula, associação obrigatória × FK nula, SET NULL × NOT NULL, `requiredWhen` × NOT NULL, domínio × coluna) |
| T001 | types | precisão/escala, string sem tamanho, limites do dialeto |
| I001 | indexes | índices inválidos, duplicados, prefixo redundante, colunas largas |
| I002 | indexes | FK sem índice de suporte |
| R001 | integrity | cascata (identificadora vs negócio, em cadeia; caminhos múltiplos SQL Server) |
| R002 | integrity | isolamento por tenant (coluna ausente, FK sem tenant) |
| R003 | integrity | redundância suspeita (aviso fundamentado, nunca erro) |
| D001 | domain | perguntas críticas, hipóteses, baixa confiança |
| D002 | domain | tradução domínio→entidade, ciclos de vida |
| C001 | contracts | divergência contrato × modelo, campos sem tratamento |
| P001/P002 | performance | consultas sem índice, OFFSET em tabela grande, PK UUID aleatória, entidade larga |
| M001 | migration | mudanças destrutivas/arriscadas vs modelo anterior/baseline |

## Correções sugeridas (fixes)
Cada problema pode trazer `fixes[]`: ações estruturadas e determinísticas (`setAttribute`, `addAttribute`, `setRelationship`, `addIndex`, `removeIndex`, `setItem`) aplicadas por `applyFix` (função pura em `packages/validators/src/fixes.ts`).

| Regra | Correções oferecidas |
|---|---|
| T001 decimal sem precisão | opções de precisão; a **primeira** é inferida só pelo nome do campo (lat/lon → 9,6; preço/valor/taxa → 18,2; medidas → 10,2) |
| T001 string sem tamanho | tipo `json`, `text`, 255 ou 1000 caracteres |
| R001 cascata | trocar para RESTRICT, ou manter CASCADE marcando como identificador (decisão de negócio) |
| S002 sem PK | adicionar chave substituta (uuid/identity conforme a convenção) |
| S004/S005 | alinhar tipo da FK, FK única ou N:1, NOT NULL × anulável × associação opcional/obrigatória |
| I001/I002 | remover índice duplicado/redundante, criar índice na FK |
| D001 | responder com uma das opções, adiar (não crítica), confirmar/rejeitar hipótese |

Correções marcadas `decision: true` dependem de decisão de negócio e **nunca** entram em lote. No Studio, “Aplicar” altera o rascunho (desfazível); no lote só entra a sugestão principal de cada problema. Via CLI: `dbarchitect fixes` lista e `dbarchitect fix <issueId> <fixId>` / `--all-rule T001 --fix precision-18-2` aplica (uma nova revisão; aprovações são invalidadas). API: `POST /api/fix`.
