# Fluxo Evolution (nova funcionalidade)

Analise só o escopo necessário, mas mantenha visíveis dependências.

1. Sessão com `mode: "evolution"`, `inspect_project`, `import_scan_facts` (cria o **baseline**).
2. Descreva a nova necessidade (user stories/contrato externo) → conceitos e regras novos.
3. **Reuse antes de criar**: procure entidades existentes que já representem o conceito; não duplique (ex.: pedido externo vs pedido interno). Pergunte quando houver dúvida.
4. Proponha apenas as alterações necessárias (ops). `get_diff` mostra somente o delta com risco de migration; alterações destrutivas exigem plano em etapas (expandir → migrar → contrair).
5. Compatibilidade: colunas novas NOT NULL em tabelas existentes precisam de default/backfill; renomeações precisam de rename explícito.
6. `validate_model` (regra M001 compara com o baseline) → `open_studio` → aprovação → geração com migrations geradas pela ferramenta oficial do ORM, revisadas pelo usuário.
