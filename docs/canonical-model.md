# Modelo canônico (CSM 1.0)

JSON validado por `packages/core/src/csm.schema.json` (draft-07, `additionalProperties: false`) e tipado em `types.ts`. Vive em `.database-architect/model.json`; cada revisão em `versions/rNNNN.json`.

Seções: `project` (modo, tecnologias detectadas, `profile` físico com `confirmed`), `status` (estado, revisão, última validação), `approvals` (por estágio `domain|model`, ligadas a hash e revisão, com `invalidatedAt`), `conventions`, `sources`, `domain` (atores, requisitos, glossário, conceitos, relações, regras, ciclos de vida, eventos, contextos), `entities`/`attributes`, `relationships`, `enums`, `indexes`, `contracts`/`mappings`, `queries`, `decisions`, `questions`, `hypotheses`, `history`.

## Separações fundamentais
Atributo: `nullable` (coluna) · `domainOptional` (negócio) · `requiredWhen` (obrigatoriedade condicional ao estado) · contrato: `requiredInRequest` / `requiredInResponse` / `nullable`. Nenhum é derivado automaticamente do outro.

## Proveniência
Todo elemento carrega `provenance.origin` ∈ user | document | code | ai | manual (+ `confidence`, `rationale`, `evidence[]`, `manuallyEdited`). O Studio mostra a origem com cor, ícone e texto.

## Hash e aprovação
`modelHash` = SHA-256 do JSON canônico (chaves ordenadas) da projeção semântica (exclui status, histórico, aprovações, fontes). Aprovar grava o hash; qualquer mudança semântica invalida (`invalidatedAt`) e retorna o estado a DRAFT/NEEDS_INPUT.

## Estados
DISCOVERING → ANALYZING → DRAFT ⇄ NEEDS_INPUT → VALIDATING → READY_FOR_REVIEW → APPROVED → GENERATING → GENERATED (FAILED). Transições em `state.ts`; só APPROVED (ou GENERATED/FAILED para regerar) entra em GENERATING.
