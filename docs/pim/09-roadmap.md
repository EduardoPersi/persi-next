# PIM — Roadmap operacional (A3.x)

## Nota sobre a numeração

Esta numeração ("A3", "A3.1", "A3.2", "A3.4", "A3.5" etc.) **não existia
formalmente em nenhum documento do repositório antes da fase A3.5A**. Ela
nasceu como uma convenção de condução de trabalho usada turno a turno, e só
foi detectada como não-documentada quando a A3.5A investigou o repositório em
busca de um roadmap PIM pré-existente e não encontrou nenhuma referência a
"A3.x" fora de comentários de código escritos durante a própria A3.4C/A3.5B.

A numeração é formalizada agora, retroativamente, para que o histórico fique
rastreável — não porque ela sempre existiu como plano documentado. As fases
anteriores a "P.1"/"P.2" (auditoria inicial e workflow editorial, ver
`00-pim-audit.md` a `03-editorial-workflow.md`) usam uma numeração diferente
e mais antiga, que também não foi unificada com esta.

## Fases concluídas

- **A3.1** — Auditoria de produção read-only do PIM Admin (rotas, RBAC,
  workflow, conflitos, audit, CSRF, isolamento de publicação, performance).
  Concluiu que o sistema não estava pronto para produção; identificou a
  ausência de mecanismo de resolução de conflitos (P0) e de ações em lote
  (P1).
- **A3.2 / A3.2B** — Workflow auditável de resolução de conflitos
  (`pim_conflicts`) e, depois de um teste humano revelar uma lacuna
  semântica, decisão semântica por valor de atributo (`pim_attribute_reviews`).
- **A3.4** — Generalização da revisão de atributos para operação rotineira,
  mesmo sem conflito associado (cardinalidade-aware, suporte a mudança de
  decisão, identidade amigável, separação de status).
- **A3.4C** — Optimistic concurrency para decisões de atributo
  (`pim_attribute_decisions`, `decisionVersion`, `PIM_ATTRIBUTE_STALE_DECISION`).
  **PASS** — qualificado end-to-end em persi-staging com o Plafon (decisão
  real version 0→1, tentativa stale com version 0 corretamente rejeitada,
  nenhuma mutação persistida pela tentativa stale, Martelo e Tesoura
  preservados).
- **A3.5A** — Auditoria read-only do extractor determinístico contra os 3080
  produtos reais de staging. **PASS**. Achado central: `diameter` e `thread`
  não são conceitos comerciais próprios — na prática, sempre bitola/bitola_mm
  capturados por um caminho de código diferente, ou ruído de dimensão
  genérica. Recomendou CREATE para material/comprimento/volume/conexao,
  MERGE de diameter em bitola/bitola_mm, DO_NOT_CREATE para diameter/thread
  como atributos próprios.
- **A3.5B** — Contrato semântico do extractor: removida a heurística "fração
  de polegada solta = thread"; bitola/bitola_mm só promovidos com confiança
  comercial suficiente (atributo estruturado, categoria hidráulica/elétrica
  ou substantivo de conexão); connection passou a ser role-aware (reaproveita
  a máquina de papéis já existente, sem taxonomia nova); nova função pura
  `parseMeasurementComponents`. **PASS** — 266/266 testes PIM, 0 mutação em
  staging, dry-run completo nos 3080 produtos comprovando `THREAD_NEW=0` e
  redução de falsos positivos de bitola genérica de 318 para 0 (medido com a
  própria função de produção, sem meta artificial de zero).
- **A3.5C — CURRENT.** Schema canônico mínimo: migration local criando os
  quatro atributos aprovados (`material`, `comprimento`, `volume`, `conexao`)
  com vocabulário inicial validado contra evidência real, reaproveitando o
  vocabulário de unidades já definido em `supabase/seed.sql` (`m`, `mL`,
  `L`). Não cria `diameter` nem `thread`. Não faz backfill. Testada em
  ambiente local efêmero (Supabase CLI local, não staging) com reset limpo e
  reexecução idempotente comprovada.

## Fases planejadas (ainda NÃO implementadas)

As fases abaixo são **planejadas**, não executadas. Nenhum código, migration
ou dado relacionado a elas existe ainda.

- **A3.5D** — Dry-run completo do extractor contra os 3080 produtos já
  usando os atributos canônicos recém-criados (pós-schema), para calibrar o
  volume real de trabalho antes de qualquer escrita em `product_attribute_values`.
- **A3.5E** — Backfill progressivo e controlado (em lotes, staging apenas,
  com contagens antes/depois) de `product_attribute_values` e, quando
  necessário, novos `pim_conflicts` para os casos ambíguos.
- **A3.5F** — Validação operacional: qualificar `reviewPimAttribute` e
  `decidePimConflictAttribute` end-to-end para os atributos novos, com pelo
  menos um teste humano real por atributo (mesmo padrão de qualificação já
  usado para `cor` com Tesoura/Martelo/Plafon).
- **A3.6** — Redesenho de cardinalidade / separação entre cardinalidade da
  evidência e cardinalidade do valor canônico decidido pelo PIM (pergunta
  central levantada na A3.4A: `attributes.cardinality` hoje só governa a
  camada de evidência, nunca a decisão).
- **A3.7** — Remediação de conflitos legados que foram resolvidos pelo
  mecanismo antigo (`resolvePimConflict`, status apenas) sem nunca receber
  uma decisão semântica real em `pim_attribute_reviews` — inclui o caso já
  identificado do Martelo Unha 29mm (conflito `c459e192-...`).
- **A3.8** — Operações em lote (bulk actions) no PIM Admin, identificadas
  como pendência P1 desde a A3.1.
- **A4** — Publicação de conteúdo aprovado do PIM para uma "published
  projection" consumida pelo storefront público. Este é o único item desta
  lista que já era documentado antes da numeração A3.x (ver
  `02-pim-admin.md`, seção "Riscos e próximos passos", e
  `03-editorial-workflow.md`) — permanece não iniciado.

## Checkpoints de PASS por fase

| Fase | Resultado | Evidência |
|---|---|---|
| A3.1 | Concluída (auditoria) | relatório read-only, sem código |
| A3.2 / A3.2B | PASS em staging | teste humano real (Martelo, Tesoura) |
| A3.4 | Implementada | 222/222 testes locais |
| A3.4C | **PASS** em staging | Plafon: version 0→1, stale rejeitado |
| A3.5A | **PASS** (auditoria) | dry-run read-only, 3080 produtos |
| A3.5B | **PASS** | 266/266 testes, dry-run pós-fix |
| A3.5C | **CURRENT** | migration local testada, 0 mutação em staging |
| A3.5D–F | PLANNED | — |
| A3.6–A3.8 | PLANNED | — |
| A4 | PLANNED (documentado antes da numeração A3.x) | — |
