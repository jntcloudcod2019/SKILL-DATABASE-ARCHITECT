# Regras de modelagem

- Domínio → lógico → físico, em etapas revisadas. Relação entre conceitos ≠ FK direta.
- Entidade persistente se tem identidade, ciclo de vida, histórico ou necessidade de consulta. Derivados e dados cuja fonte da verdade é externa: considere não persistir ou guardar só a referência (`sourceOfTruth: "external:<sistema>"`).
- Nulabilidade: `nullable` (coluna) ≠ `domainOptional` (negócio) ≠ obrigatório em request/response (contrato). Obrigatoriedade condicional a estado ⇒ `requiredWhen` + coluna anulável + CHECK/regra, não NOT NULL cego.
- Relacionamento: dependente(FK) → principal; `required` coerente com a nulabilidade da FK; `onDelete` explícito. CASCADE apenas para dependência existencial (`identifying: true`) e sem cadeias longas; prefira RESTRICT + exclusão lógica para dados de negócio.
- N:N sempre via entidade de associação (que costuma ter dados próprios).
- Chaves: estratégia única e explícita (`conventions.primaryKeyStrategy`); unicidade composta para idempotência de integrações (ex.: restaurante + canal + id externo).
- Índices: toda FK relevante, filtros/ordenações de consultas conhecidas; não invente ganhos — informe `estimatedRows` quando conhecido.
- Desnormalização intencional é válida: documente em `rationale`/`decisions`.
- Multi-tenant: defina `conventions.tenancy`; toda entidade de dados de tenant tem a coluna.
