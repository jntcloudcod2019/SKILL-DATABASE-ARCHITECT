# Matriz de suporte real

Verificado = executado neste repositório. “Gerado” = produz arquivos, sem execução no banco.

## Análise (brownfield/evolution)
| Tecnologia | Extração | Observações |
|---|---|---|
| .NET `.csproj`/`.sln` | detecção (framework, EF Core, Dapper, provedores) | |
| EF Core | entidades via `DbSet<>`/`[Table]`, data annotations, Fluent API (`OnModelCreating`, `IEntityTypeConfiguration`), relações, índices, enums, migrations (nomes/operações destrutivas) | sem avaliação semântica de código condicional; shadow properties não detectadas |
| EF Core — owned/complex/JSON | `OwnsOne` (colunas na tabela do dono, `Nav_Prop`, aninhado até 3 níveis, opcional ⇒ colunas anuláveis, `HasColumnName`), `OwnsMany` (tabela própria, FK do dono com cascade, chave `Id` sombra ou `HasKey`, `ToTable`, `WithOwner().HasForeignKey`), `ComplexProperty`/`[ComplexType]`/`[Owned]`, `ToJson()`, colunas `json`/`jsonb` (`HasColumnType`, `[Column(TypeName)]`, `JsonDocument`/`JsonNode`, conversão `JsonSerializer`) com o formato interno na descrição | nomes físicos sem `HasColumnName`/`ToTable` seguem a **convenção** do EF Core e são marcados como tal (confirme na migration/banco); `OwnsOne("Tipo","Nav")` por string/`typeof` e OwnsMany aninhado em owned não são seguidos. Verificado só com fixture, não com projeto real |
| Dapper | SQL inline `Query*/Execute*` (SELECT) → consultas conhecidas | |
| Prisma | `schema.prisma` completo (modelos, enums, relações, índices, @map) + migrations | |
| TypeORM / Sequelize / Drizzle / Knex / Mongoose | **somente detecção** (com aviso de limitação) | extração não implementada |
| OpenAPI 3 / Swagger 2 (JSON/YAML) | contratos, request vs response, obrigatórios, nullable | `$ref` externos e `oneOf/anyOf` não expandidos |
| JSON Schema | contratos | |
| SQL DDL | `CREATE TABLE`, PK/FK/UNIQUE inline e nomeados, `CREATE INDEX`, `ALTER … ADD FOREIGN KEY` | parser tolerante, não completo |
| TS DTOs | interfaces/types exportados simples | |
| Markdown | títulos como fontes | |
| Strings de conexão | provedor e chave; **valor nunca é lido/registrado** | |
| Java, Python, PHP, Ruby | **não implementado** (extensível via `Analyzer`) | |

## Geração
| Alvo | Dialetos | Verificação realizada |
|---|---|---|
| `sql` | sqlite, postgresql, sqlserver, mysql | sqlite: DDL executado em memória (real). Demais: gerados, não executados |
| `prisma` | postgresql, sqlite, mysql, sqlserver | `prisma validate` (v5) passou para postgresql no modelo de exemplo |
| `ef-core` | postgresql, sqlserver, sqlite, mysql | `dotnet build` (SDK 10, net8.0) passou para postgresql no modelo de exemplo. **Migrations não geradas** (`dotnet ef migrations add` fica para o usuário) |
| `dapper` | postgresql, sqlserver, sqlite, mysql | `dotnet build` passou para postgresql e sqlserver; DDL sqlite executado |

`dotnet build` e `prisma validate` exigem rede (NuGet / binários Prisma); não rodam dentro de um sandbox sem acesso.
