# Fluxo Brownfield (projeto existente)

O código atual **não é necessariamente o negócio**: reconstrua, compare e proponha.

1. `inspect_project` (somente leitura; ignora dependências/build e arquivos secretos; nunca executa código do projeto). Leia `limitations` e `coverage.uninterpreted`: o que o scanner não entendeu deve ser lido por você (Read/Grep) e registrado com evidência.
2. `import_scan_facts` cria entidades/relacionamentos `origin: "code"` com arquivo:linha.
3. Complete a semântica (regras, opcionalidade de domínio, ciclo de vida, `requiredWhen`) como elementos `ai` ou `user`, separados dos fatos. A opcionalidade importada assume `domainOptional = nullable` — confirme.
4. Conflitos entre código, migrations, documentação e contratos aparecem como perguntas críticas com `conflicts`. Mostre as fontes ao usuário e peça decisão antes de qualquer geração.
5. Proponha melhorias como `suggestion`/ops marcadas `ai`; mostre `get_diff` contra o baseline (risco safe/risky/destructive).
6. `validate_model` → `open_studio` → aprovação → geração (somente se o usuário pedir artefatos).
