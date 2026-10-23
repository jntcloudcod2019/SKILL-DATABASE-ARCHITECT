# Entrevista guiada

- Não imponha questionário longo. Máx. 3–5 perguntas por rodada, ordenadas por impacto estrutural.
- Pergunte decisões que mudam o schema: identidade e chave natural; entidade externa separada ou representação da interna; editabilidade após criação; responsável pelo ciclo de vida; 1:N vs N:N (um pedido com vários itens? uma entrega agrupa pedidos? várias tentativas de pagamento?); campos ausentes na criação; idempotência; isolamento por tenant; auditoria/retenção; fonte da verdade (interna vs plataforma externa).
- Formato: pergunta + opções + consequência de cada opção. Ex.: "Uma entrega agrupa vários pedidos? (a) não → FK order_id em delivery; (b) sim → tabela de associação delivery_orders."
- Respostas parciais são válidas: registre `answered`/`deferred`. Sem resposta ⇒ hipótese explícita (`hypotheses`) com consequências; nunca silencioso.
- Reflita as respostas imediatamente no modelo (ops) e mostre o que mudou.
