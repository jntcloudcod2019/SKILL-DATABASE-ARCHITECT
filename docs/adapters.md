# Criar adaptadores e geradores

Contratos em `packages/core/src/adapters.ts`.

## Analisador (detector / extrator / ORM / contrato)
```ts
export const meuAnalisador: Analyzer = {
  id: 'meu', category: 'orm',
  accepts: (path) => path.endsWith('.minhaext'),
  analyze(files) { const f = emptyFacts(); /* preencher tables/relations/contracts com evidências */ return f; },
};
```
Registre em `analyzers` (`packages/engine/src/engine.ts`). Regras: sempre preencha `evidence` (arquivo/linha), declare `limitations`, nunca execute código do projeto, nunca leia segredos.

## Dialeto
Implemente `Dialect` (`adapters/sql/src/dialects.ts`): `quote`, `columnType`, limites (`maxDecimalPrecision`, `maxVarchar`).

## Gerador
Implemente `Generator` (`generate({model, revision, hash, dialect, previous, options}) → {files, report}`), registre em `packages/engine/src/generators.ts` (`generators`, `SUPPORT`). Declare em `report` avisos/não suportado. **Verifique com a ferramenta oficial** quando possível e só então liste o par na matriz de suporte.

## Validador
Adicione uma `Rule` (`packages/validators/src/rule.ts`) a uma categoria e a `allRules`. Regras são puras e testáveis sem IA; bloqueante só `critical`/`modeling` (ou `blocking` explícito).
