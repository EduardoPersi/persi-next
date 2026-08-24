# ADR 001 — acesso ao PostgreSQL

- Status: aceito para implementação na Fase C
- Data: 23/08/2026
- Escopo: Persi Database V1

## Contexto

O projeto usa Next.js 16, Node, TypeScript strict e npm, sem DAL ou ORM atual. O
banco será PostgreSQL gerenciado pelo Supabase, com migrations revisáveis e
acesso prioritariamente pelo servidor. A solução precisa suportar transações,
locks de estoque, inbox/outbox, SQL específico do PostgreSQL e pooler.

## Opções avaliadas

| Opção | Pontos fortes | Limitações no contexto Persi |
| --- | --- | --- |
| Supabase JS/Data API | RLS e Auth integrados; HTTP; simples no browser | Não é a melhor fronteira para transações multi-step, row locks e SQL avançado; incentivaria acesso browser que não é necessário |
| Drizzle ORM + driver PG | Tipos TS, schema explícito, SQL visível, baixo overhead, transações e escape hatch SQL | Nova dependência; exige disciplina para não manter duas fontes divergentes de migrations |
| Prisma | DX e geração de client maduras, schema declarativo e tooling amplo | Camada/runtime e workflow de migration adicionais; SQL/recursos PG específicos menos diretos; maior custo operacional para este monólito |
| SQL direto + driver | Máxima visibilidade, controle e mínimo de abstração | Mais mapeamento manual, risco de drift de tipos/DTOs e repetição em um domínio grande |

## Decisão

Adotar **Drizzle ORM com um driver PostgreSQL compatível com a topologia
aprovada**, apenas no servidor, e usar **migrations SQL versionadas no formato do
Supabase CLI como fonte única de mudança de schema**.

Drizzle será query builder/mapeador tipado, não dono de uma segunda sequência de
migrations. Na Fase C, o schema TypeScript deverá refletir as migrations e um
teste de drift deverá ser planejado. Recursos específicos (partial indexes,
constraints, RLS, triggers, FTS e funções) continuam expressos em SQL revisável.

O driver escolhido na Fase C é Postgres.js, com prepared statements desabilitados
para funcionar também com Supavisor transaction mode. A versão Node LTS e a
topologia Hostinger ainda precisam ser confirmadas antes de produção.

## Conexões

```text
Browser -> Route Handler/Server Component -> DAL Drizzle -> runtime connection
Supabase CLI / pg_dump / restore ------------------------> direct connection
```

- `DATABASE_URL`: runtime, server-only. Em processos efêmeros/autoscaling, usar
  pooler em transaction mode e desabilitar prepared statements. Em processo
  Node persistente, preferir direct connection se IPv6/rede permitir; caso
  contrário, session pooler. A escolha final depende do runtime Hostinger real.
- `DIRECT_URL`: migrations, dump e restore; conexão direta, nunca usada por
  requests e nunca exposta ao browser.
- Pool do cliente deve ser singleton por processo e pequeno; não abrir conexão
  por request. Timeout e limites serão configurados e observados.
- Service role do Supabase não é necessária para SQL wire protocol. Se um
  recurso futuro exigir `supabase-js`, a key privilegiada fica server-only.

A documentação oficial do Supabase recomenda conexão direta para migrations,
`pg_dump` e backends persistentes; session pooler para backends persistentes
IPv4-only; e transaction pooler para clientes temporários/serverless. Transaction
mode não suporta prepared statements. Fonte:
[Supabase — Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Migrations e ambientes

- Convenção: `supabase/migrations/<timestamp>_<domain>.sql` na Fase C.
- Local: Supabase CLI/Docker quando suportado; reset somente contra referência
  local explicitamente validada.
- Staging: aplicação manual/CI com environment guard e revisão.
- Production: deploy automático permanece desativado; exige aprovação, backup,
  dry-run/plan aplicável e rollback documentado.
- Nunca usar push de schema gerado silenciosamente como fonte de verdade.

## Segurança

- Módulos DAL importam `server-only`.
- Roles distintas: migration owner, application runtime e, futuramente,
  read-only/worker. Runtime não recebe DDL nem `BYPASSRLS`.
- Queries parametrizadas; nenhum identificador dinâmico vindo do cliente.
- RLS complementa a autorização de aplicação; não substitui ownership checks.

## Consequências

Positivas: tipagem próxima ao SQL, revisão clara, bom suporte a transações e
menor acoplamento ao Data API. Custos: duas representações coerentes (SQL e
schema TS) precisam de testes; equipe aprende Drizzle; driver/topologia devem ser
validados antes da primeira conexão.

## Alternativas rejeitadas agora

- Supabase JS como DAL principal: útil para Data API/RLS, insuficiente como
  escolha única para o núcleo transacional desenhado.
- Prisma: válido, mas adiciona mais convenções/runtime do que o necessário para
  este projeto SQL-first.
- SQL puro: continuará disponível para migrations e casos avançados, porém não
  oferece sozinho a segurança de tipos desejada no código de aplicação.

## Condições antes da Fase C

1. Aprovação humana da nova dependência Drizzle e do driver.
2. Fixação de Node LTS suportado pela hospedagem.
3. Confirmação se o runtime é persistente ou efêmero e de conectividade IPv6.
4. Verificação do modo/pool disponível no plano Supabase, sem presumir tier.
5. Prova local de transação, lock, transaction pooler e migrations do zero.
