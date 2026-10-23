# Cheatsheet do CSM (formato 1.0) e das operações

`propose_model_ops` recebe `{ops:[...]}`:
- `{"op":"upsert","collection":"entities","item":{...}}` — substitui o item de mesmo `id` (ou cria).
- `{"op":"remove","collection":"entities","id":"..."}`
- `{"op":"set","path":"project.profile","value":{...}}` — paths: `project.name`, `project.description`, `project.profile`, `conventions`, `domain.problem`, `domain.goals`.

Coleções: `entities relationships enums indexes contracts mappings queries decisions questions hypotheses sources domain.actors domain.requirements domain.glossary domain.concepts domain.conceptRelations domain.rules domain.lifecycles domain.events domain.contexts`.

Todo item tem `provenance: {origin: user|document|code|ai|manual, confidence?, rationale?, evidence?: [{source, file?, line?, excerpt?}]}`. IDs: `[A-Za-z0-9_.:-]`, estáveis.

Entidade mínima:
```json
{"id":"order","name":"Order","table":"orders","kind":"entity","persistence":"persistent","uniqueConstraints":[],"checks":[],
 "attributes":[{"id":"id","name":"Id","domainType":"uuid","nullable":false,"domainOptional":false,"primaryKey":true,"generated":"uuid","provenance":{"origin":"ai","rationale":"…"}}],
 "provenance":{"origin":"ai","rationale":"Pedido tem identidade, ciclo de vida e histórico"}}
```
Relacionamento: `{"id":"order_restaurant","from":{"entity":"order","attributes":["restaurant_id"]},"to":{"entity":"restaurant","attributes":["id"]},"cardinality":"N:1","required":true,"onDelete":"restrict","provenance":{…}}`.
Pergunta: `{"id":"q_x","text":"…","impact":"critical|high|medium|low","status":"open","options":["a","b"],"consequences":"…","relatedTo":["order"],"provenance":{"origin":"ai"}}`.
Tipos de domínio: string text integer bigint decimal money boolean date datetime time uuid json binary enum.
Mapeamento de contrato: `{"id":"m1","contract":"<id>","field":"externalId","treatment":"stored|derived|ignored|external-reference","entity":"order","attribute":"external_id","provenance":{…}}`.
