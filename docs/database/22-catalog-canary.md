# F.4 — Controlled catalog read canary

> F.4.2 parcial (2026-08-26): adapter local expandido, mas o Gate A remoto detectou 13 divergências comerciais. `ADAPTER_STAGE0_READY=NO`, cache permanece bloqueado para uso operacional e canary continua 0%.

## Estado

Execução interrompida com segurança no primeiro gate. Nenhum tráfego, deploy, webhook, cron ou variável de produção foi alterado.

## Rotas e consumidores auditados

- PDP: `app/_storefront/product-page.tsx`, catch-all público e API de produto.
- Home: `app/page.tsx`, Flash Deals e recomendações.
- Categoria: ProductGrid e serviços de categoria.
- Marca: serviço de marcas e listagens.
- Busca: página/serviço de busca e sugestões.
- Consumidores auxiliares: navegação de produto, favoritos, recentemente vistos e produtos de fallback de 404.

Hoje esses consumidores ainda importam os serviços Woo diretamente. Existe adapter PostgreSQL e shadow read para produto, mas ainda não há um repository/router único conectado a todos os fluxos.

## Cache audit

- produto/listagens Woo: revalidate configurável; pontos observados de 30 s, 5 min e 24 h conforme operação;
- recomendações: `unstable_cache`, 120 s;
- menu: `unstable_cache`, 300 s;
- frete grátis: cache próprio;
- Flash Deals: cache próprio;
- checkout/cart/pedidos/pagamentos: `revalidate=0`/no-store e permanecem fora do escopo;
- CDN/Cloudflare real não foi inspecionado, portanto cache parity não pode ser aprovado.

Preço/estoque do futuro adapter PostgreSQL devem usar revalidação compatível com freshness e nunca contaminar cart/checkout. O kill switch será `CATALOG_CANARY_ENABLED=false` ou percent 0, com fail-closed para Woo.

## Adapter preflight

Staging contém 3.080 produtos simples, todos com exatamente uma variant, SKU presente, status active, visibility não hidden e purchasable true. Entretanto o DTO/adapter atual ainda não expõe ao consumidor final product type, commercial semantics, tags e mídia de taxonomias. A paridade no banco está comprovada; a paridade do contrato público final ainda precisa ser implementada e validada antes do Stage 0.

## Gates não executados

- worker/reconciliation real na Hostinger;
- configuração e teste real dos webhooks Woo;
- alteração controlada e reversível de catálogo;
- router/stickiness/fallback em runtime implantado;
- failure injection no deploy;
- SEO/HTML parity renderizada no runtime;
- Stage 0 interno;
- Stage 1 público a 1%;
- rollback do deploy/config.

## Condições para Stage 1

Stage 1 permanece proibido até: runtime real auditado, adapter completo, worker e reconciliation ativos, webhooks signal-only validados, pre-convergence 0/0, Stage 0 aprovado, failure injection/fallback aprovados, cache/SEO parity e observabilidade disponíveis. Se liberado futuramente, começa em 1%, não aumenta automaticamente e volta imediatamente a 0% em qualquer stop condition da especificação.
