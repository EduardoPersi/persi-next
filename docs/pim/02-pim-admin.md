# PIM P.1 — painel administrativo

## Rotas

- `/admin/products`: listagem paginada, busca por nome/SKU/GTIN e filtros de marca, categoria, workflow, imagem e GTIN.
- `/admin/products/[id]`: visão geral, atributos, conteúdo, SEO, mídia, origem e histórico.
- `/admin/pim`: atalhos da fila de revisão para needs review, AI suggested, ambiguous, unmapped, missing data, ready e approved.

## Operação

Preço e estoque são explicitamente somente leitura. Atributos mostram valor, origem, status e confiança. Sugestões pendentes podem ser aprovadas ou rejeitadas individualmente; a decisão usa transação, trava a linha e grava audit trail. Aprovar uma sugestão não altera source data nem publica conteúdo nesta fase.

## Responsividade e acessibilidade

O painel prioriza densidade desktop, mantém container amplo e usa overflow horizontal nas tabelas. Campos possuem labels, navegação e ações usam elementos semânticos e foco global visível.

## Riscos e próximos passos

- executar rebuild local e EXPLAIN ANALYZE após confirmar Docker/ambiente;
- backfill explícito de profiles somente em fase autorizada;
- adicionar edição de conteúdo PIM e promoção aprovada para published projection;
- definir política detalhada para shared ownership;
- criar integração real de IA e mídia R2 apenas em fases futuras.
