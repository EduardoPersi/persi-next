# PIM P.1 — arquitetura

## Camadas e ownership

`SOURCE DATA` é o read model operacional sincronizado de Woo/Olist. SKU, GTIN oficial, preço, estoque, disponibilidade e dados brutos são somente leitura no painel. `PIM DATA` contém nome comercial, conteúdo, atributos normalizados, aplicação, SEO e sinônimos. `PUBLISHED DATA` será uma projeção futura de dados aprovados; não é ativada na P.1.

Marca, categoria, mídia e slug são compartilhados/controlados. Qualquer futura mudança exige regra de reconciliação; slug nunca é alterado automaticamente. Woo continua autoridade e não há dual write.

## Workflow

Estados: `raw → normalized → needs_enrichment → ai_suggested → needs_review → approved → published`, com `rejected` como decisão lateral. `approved_at` é obrigatório para approved/published e `published_at` para published. A P.1 não publica dados.

## Provenance e auditoria

Fontes controladas: Olist, WooCommerce, fabricante, manual, IA, migration e referência externa. Reviews e suggestions guardam source, referência/evidência, confidence 0–1, decisão e revisor. `pim_audit_log` registra entidade, campo, valor anterior/novo quando apropriado, ator, operação, motivo e timestamp. Não armazena secrets ou PII desnecessária.

## Medidas e identidade

O valor canônico comercial permanece inteiro em `attribute_values.display_value`. `25mm x 1/2"` nunca vira três valores concorrentes. Componentes auxiliam busca e filtro. Unidade ausente não é inferida. SKU, GTIN, marca, modelo, tensão e especificações nunca são inventados; ausência/ambiguidade segue para revisão.

## IA futura

`PimEnrichmentProvider` é um contrato sem implementação paga. Toda saída entra em `pim_suggestions` como `needs_review`; confidence não aprova conteúdo automaticamente. Nenhuma chamada externa ou enriquecimento em massa faz parte da P.1.

## Segurança e performance

Banco é importado por módulos `server-only`; páginas são Server Components. A autorização usa sessão JWT validada no servidor e exige role `administrator`/`shop_manager` ou capability administrativa. RLS permanece habilitada sem policies públicas. Listagem usa paginação server-side (25/50/100), filtros SQL e índices de workflow/review; nunca envia o catálogo inteiro ao browser.

## Mídia futura

Somente URL e metadata são exibidas. Uma futura topologia Olist → PIM → R2 → CDN → Next exige fase própria; nenhum binário foi migrado.

## P.2 — ownership editorial

As colunas editoriais de `pim_product_profiles` representam o draft atual. `approved_content` guarda um snapshot JSONB do último conteúdo aprovado, com arrays reais para bullet points e search terms. O snapshot aprovado não alimenta o catálogo público e permanece imutável durante novas edições.

`version` é o token de optimistic concurrency. Toda escrita trava o profile, compara a versão aberta pelo administrador e rejeita versão antiga. Alteração e auditoria usam a mesma transação. O actor é derivado exclusivamente da sessão administrativa validada no servidor.

Preço, estoque, reservas, SKU, GTIN e mappings externos continuam pertencendo à camada operacional. A P.2 não oferece writes para esses domínios. Atributos permanecem somente leitura até uma fase posterior com provenance e workflow específicos.
