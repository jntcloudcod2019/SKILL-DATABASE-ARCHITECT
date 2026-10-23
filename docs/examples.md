# Exemplos completos

## 1. Greenfield — restaurantes (sem código)
```bash
dbarchitect open ./pedidos --mode greenfield --description "Gestão de pedidos para restaurantes: iFood, 99Food e canais próprios, entregas, motoboys, pagamentos, taxas e notificações."
```
No Claude Code: a skill entrevista (“pedido externo é entidade separada?”, “uma entrega agrupa pedidos?”), grava o domínio e perguntas, abre o Studio; você aprova; escolha `sql`/`sqlite` para verificar o DDL executando-o.

## 2. Brownfield — EF Core
```bash
dbarchitect analyze fixtures/dotnet-efcore
dbarchitect status fixtures/dotnet-efcore
```
Gera 3 entidades com evidência arquivo:linha, enum `OrderStatus`, relações com ON DELETE; `.env` e a senha em `appsettings.json` não aparecem em lugar nenhum.

## 3. API externa (OpenAPI) sem virar tabelas
```bash
dbarchitect init ./integra --mode greenfield
dbarchitect import-docs fixtures/external-api/delivery-platform.openapi.yaml
```
Contratos `OrderCreate`/`OrderView` ficam com requisição × resposta distintas; cada campo precisa de tratamento (armazenado/derivado/ignorado/referência) no painel de Contratos.

## 4. Do modelo ao projeto
```bash
dbarchitect approve ./pedidos --by "Maria"
dbarchitect generate ./pedidos --target ef-core --dialect postgresql --namespace Pedidos
dbarchitect plan-apply ./pedidos --target ef-core --dialect postgresql
dbarchitect apply ./pedidos --target ef-core --dialect postgresql --yes-write
# depois, com a ferramenta oficial: dotnet ef migrations add Initial
```
