# Roadmap

Limitações conhecidas (honestas)
- Sem execução em PostgreSQL/SQL Server/MySQL reais; sem `EXPLAIN` (não há conexão a bancos por design).
- EF Core: migrations não são geradas pela ferramenta; shadow properties/configuração condicional não são lidas.
- Extração de TypeORM, Sequelize, Drizzle; Java/Python/PHP/Ruby não implementados.
- Scripts de evolução de schema (ALTER) ainda não são gerados; o diff com risco existe, a geração de ALTER não.
- Studio: sem edição de índices/enums/queries na UI (apenas visualização e via MCP/CLI); sem testes E2E de navegador automatizados nesta fase.
- Git não foi inicializado no diretório pelo ambiente de desenvolvimento.

Próximos passos sugeridos
1. Bateria de testes de scanner/MCP/API/Playwright e lint/typecheck em CI.
2. Gerador de scripts de evolução (ALTER) com etapas seguras a partir do diff.
3. Extratores TypeORM/Drizzle e primeira linguagem fora de .NET/Node (Python/SQLAlchemy).
4. Opt-in de leitura de plano de execução com conexão autorizada separadamente.
