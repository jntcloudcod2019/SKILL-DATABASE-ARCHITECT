# Registro de decisões arquiteturais

1. **TypeScript em todo o produto; Node ≥ 22.18 sem etapa de build** para CLI/engine/MCP (type stripping nativo). Studio usa Vite.
2. **CSM em JSON + JSON Schema (Ajv)**, versionado (`formatVersion`). `additionalProperties:false` para detectar deriva.
3. **Um núcleo, três modos.** O modo só muda a origem dos dados e o baseline; modelo, validadores, aprovação e geradores são os mesmos.
4. **Fatos × hipóteses por proveniência obrigatória**; o motor rejeita `origin: code` sem evidência de arquivo vindo da IA.
5. **Aprovação humana, ligada a hash**, sem ferramenta MCP de aprovação. Qualquer mudança invalida.
6. **Aprovação do modelo ≠ autorização de escrita.** Geração vai para staging; `apply` exige `--yes-write`/`authorize`; migrations existentes nunca são sobrescritas; migrations de ORM são criadas pelas ferramentas oficiais e nunca aplicadas.
7. **Servidor local**: 127.0.0.1, checagem de Host (anti DNS-rebinding), token por execução, sem CORS.
8. **Estado em arquivos JSON** em `.database-architect/` (versionável, revisável), com snapshot por revisão; sem banco para o próprio estado.
9. **Verificação real onde possível**: SQLite em memória, `dotnet build`, `prisma validate`; o resto é declarado como não verificado.
10. **Scanner não é parser completo**: extrai estrutura verificável; semântica fica com a IA/usuário, registrada com origem própria.
