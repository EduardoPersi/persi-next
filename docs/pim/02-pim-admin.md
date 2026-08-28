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

## P.2 — endurecimento operacional

A P.2 corrige o contrato entre as queries PostgreSQL e os componentes do painel. Campos SQL compostos agora usam aliases `camelCase` explícitos, evitando que imagem, preço, promoção, status, contadores e timestamps cheguem como `undefined` apesar da tipagem TypeScript.

A rota `/admin/pim` consulta contagens reais no banco para as filas de revisão, sugestões de IA, conflitos, itens sem mapping, dados ausentes, itens prontos e aprovados. O filtro `issue=missing` considera ausência de GTIN ou imagem principal. Essa etapa permanece somente leitura, exceto pela decisão individual de sugestões já existente; não cria backfill, não publica dados e não escreve no WooCommerce.

O detalhe do produto passa a mostrar ORIGINAL, DRAFT e APPROVED. Apenas DRAFT possui campos editáveis. As ações visíveis dependem do estado: salvar/enviar, aprovar/rejeitar, reabrir ou descartar. Conflitos de versão exibem “Este produto foi alterado desde que você abriu a página.”. O histórico mostra ação, data, actor server-side e motivo, sem expor credenciais.
