# F.3 — Canary readiness

> Atualização F.4.2 (2026-08-26): Gate A interrompido após auditoria read-only de 3.080/3.080 produtos. Foram encontradas 13 divergências comerciais (`woo_stock_status`: 12; `popularity`: 1). Filtros 7/7, ordenações 6/6, paginação, RLS 27/27, zero policies e inbox zerado passaram. Stage 0 e deploy não foram executados. Consulte `24-runtime-integration-stage0.md`.

> Atualização F.4: a prontidão de dados da F.3 permanece válida, mas o gate de runtime real da Hostinger não pôde ser fechado no ambiente disponível. Consulte `21-hostinger-runtime.md` e `22-catalog-canary.md`. Canary permanece em 0%.

## Resultado

O catálogo PostgreSQL está tecnicamente pronto para uma F.4 controlada. Isso não ativa tráfego, canary, webhook ou scheduler. WooCommerce segue autoridade e a aplicação pública continua lendo Woo.

## Semântica e dados

- 3.080 produtos confrontados; Critical/High/Medium/Low = 0/0/0/0.
- purchasable, visibility, stock, backorder, manage stock, rating summary, featured, popularity, tags e frete grátis: zero diferenças.
- 3.791 relações de tags; 401 referências de imagem de categoria/marca corrigidas e zero diferenças finais.
- Backorders não são usados nos 3.080 produtos atuais. Um futuro `yes`/`notify` replica `allows_backorder=true`; a compra nunca é inferida localmente.
- Política de archive: `publish -> active`; `trash -> archived`; demais estados não públicos -> `draft`. Não há hard delete. Republish limpa `archived_at` e reutiliza UUID/mapping. A varredura atual encontrou somente `publish`.

## Backfill e reconciliação

O backfill processou 31 lotes de 100 em 268.196 ms, sem retries. Preencheu 2.978 versões que estavam ausentes; cobertura final 100%, backlog 0. A primeira passagem atualizou as 3.080 linhas porque as colunas eram novas. A segunda passagem convergida: zero updates de domínio, zero mapping updates, zero crescimento e zero retries. A reconciliação completa posterior comparou 3.080/3.080 e terminou 0/0/0/0.

## Worker e operação

O worker usa `FOR UPDATE SKIP LOCKED`, retry exponencial, dead-letter e lease de 5 minutos. O teste real local criou 41 sinais: dois workers processaram 40 sem duplicação/deadlock e um sinal abandonado foi recuperado após lease, com 41 processados, 0 pending e 0 dead-letter.

Topologia documentada comprova hospedagem Node na Hostinger, mas não comprova ainda um supervisor persistente. Recomendação para F.4, sem ativação nesta fase:

- worker contínuo, ou execução a cada 15–30 s se o plano suportar apenas cron;
- reconciliação incremental a cada 5 min;
- reconciliação completa noturna;
- retenção: remover apenas `processed` com mais de 30 dias; nunca apagar dead-letter automaticamente.

CLI: `f3-inbox-ops.mjs --staging --action=list`; retry/resolve/prune exigem `--approved-inbox-operation`. Estado final: 0 dead letters.

## Webhook e segurança

Endpoint futuro: `POST /api/internal/catalog-sync/webhook`, tópicos `product.created`, `product.updated`, `product.deleted`, `product.restored`. Exige `application/json`, corpo bruto máximo 64 KiB, HMAC SHA-256 base64 e comparação timing-safe. `delivery-id` único fornece replay protection; resposta é 202. O webhook é apenas sinal: worker sempre busca o estado corrente no Woo. Não foi configurado no Woo.

Health futuro: `GET /api/internal/catalog-sync/health`, protegido por Bearer timing-safe, `private, no-store`, sem segredos ou payloads. Verifica DB, backlog, pending mais antigo, dead letters, frescor e cobertura.

## Performance e capacidade

Leituras PostgreSQL p50/p95: slug 19,8/24,4 ms; SKU 19,5/34,8 ms; categoria 19,9/22,0 ms; marca 19,8/23,9 ms; busca 29,7/37,3 ms. Golden search: 68,1/337,5 ms incluindo round-trip remoto; filtros finais: 19,55/65,25 ms. Banco: 54,9 MiB.

Projeção linear conservadora a partir de 3.080 produtos: ~89 MiB para 5.000 e ~178 MiB para 10.000, antes de folga operacional. Inbox deve permanecer limitada pela retenção; índices e busca devem ser medidos novamente no próximo gate.

## Futura F.4 — desenho, não ativado

`request -> assignment persistente por cookie/sessão -> PostgreSQL -> fallback Woo somente em timeout/indisponibilidade técnica elegível`. Divergência comercial, produto ausente, preço/estoque/purchasable incompatível não permitem fallback silencioso: devem gerar métrica/alerta. Stickiness evita alternância visual na mesma navegação.

Cache de catálogo deve preservar revalidação curta para preço/estoque; carrinho, checkout, pedido e pagamento seguem sem cache privado e Woo autoritativo. URLs, slugs, canonical, metadata, schema.org, breadcrumbs, sitemap e robots não mudam com o datasource. O limite é explícito: PostgreSQL lê catálogo; Woo continua autoridade de cart/order/payment/inventory. Olist continua `Olist -> Woo -> sync -> PostgreSQL`.

## Comando e gates

`node scripts/database/catalog-import/f3-canary-readiness.mjs`

O comando reexecuta auditoria integral, golden e saúde. Gate exige produto/comercial/mídia/filtros/sorts/paginação/search/coverage/inbox/RLS/policies/search documents todos aprovados. `YES` significa apenas prontidão técnica, nunca autorização para tráfego.
