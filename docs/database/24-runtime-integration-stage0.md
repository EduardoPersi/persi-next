# F.4.2 — Runtime integration + Stage 0

## Estado em 2026-08-26

A fase foi interrompida no Gate A. WooCommerce continua autoridade, PostgreSQL continua réplica e o canary público permanece em 0%. Não houve deploy, alteração de environment, Stage 0, scheduler ou webhook real.

## Trabalho local parcial

- `CatalogProduct` passou a representar tipo, variantes, default variant, semântica comercial, tags, rating, popularidade, frete grátis e mídia/hierarquia de taxonomia.
- O aggregate PostgreSQL passou a selecionar essas semânticas e todas as variantes sem assumir permanentemente `1 product = 1 variant`.
- Foram preparados primitives locais de cohort opaco, bucket SHA-256 determinístico, defaults Woo/0%, timeout de 750 ms, fallback Woo e cache keys com source.
- Essa infraestrutura não foi conectada ao tráfego público nem a todas as camadas de cache; portanto stickiness e isolamento de cache não estão operacionalmente concluídos.
- Nenhuma migration foi criada ou aplicada.

## Gate A — resultado read-only

- produtos confrontados: 3.080/3.080;
- divergências comerciais: 13;
- `woo_stock_status`: 12;
- `popularity`: 1;
- category/brand media: zero divergências;
- filtros: 7/7;
- ordenações: 6/6;
- paginação: primeira 100, intermediária 100, última 80, página vazia 0 e sem duplicatas;
- inbox pending/retry/dead-letter: 0/0/0;
- RLS: 27/27; policies públicas: 0.

Critical/High precisa ser zero. Logo `ADAPTER_STAGE0_READY=NO`. Golden 14/14 agregado, DTO final integral, cache operacional, jobs internos, runtime DB, Stage 0, SEO parity e failure injection não foram executados após a falha.

## Blocker e retomada

O Woo mudou enquanto o processamento incremental não está ativo: o número de diferenças de stock status aumentou e apareceu drift de popularidade. A próxima retomada precisa reconciliar essas diferenças de Woo para PostgreSQL pelo fluxo versionado e autorizado, sem hard delete, dual write ou PostgreSQL → Woo. Depois deve repetir 3.080/3.080; somente com Critical/High/Medium/Low em zero a fase pode avançar.

O Gate D continua exigindo ação humana futura no hPanel: `DATABASE_URL` deverá vir do Supabase Transaction Pooler e ser cadastrada sem ser enviada ao chat; `DIRECT_URL` deve permanecer fora do web runtime.

## F.4.2A — reconvergência controlada

Em 2026-08-26, os 13 drifts iniciais foram classificados como `UNSYNCED_SOURCE_CHANGE` e reconvergidos pelo pipeline oficial. A paridade comercial voltou a zero. O DTO parity encontrou ainda um preço stale no Woo ID 14806, também anterior à janela e ausente do comparator comercial; ele foi reconvergido pelo mesmo pipeline. O resultado final de dados foi 3.080/3.080 e 0/0/0/0, com golden 14/14, filtros 7/7 e ordering 6/6.

O Gate A, porém, permanece bloqueado: a mudança real de preço 7100 → 8835 gerou duas entradas equivalentes em `price_history`. O schema possui o trigger `capture_price_history`, enquanto `CatalogImporter` também faz insert explícito. Nenhuma linha foi apagada ou alterada manualmente. Consulte `25-gate-a-reconvergence.md`.
