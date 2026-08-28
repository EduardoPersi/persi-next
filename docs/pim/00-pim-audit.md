# PIM P.1 — auditoria do existente

## PIM_EXISTING_SCHEMA

O catálogo já separa `products` e `product_variants`; SKU, GTIN e dimensões logísticas estão na variant. Preços (`prices`, `price_history`) e estoque (`inventory_levels`, reservations e movements) são domínios separados. Marca, categorias, mídia e mappings externos são relacionais. O PIM existente é tipado por `attributes`, `attribute_values`, `units`, `measurement_components`, `product_attribute_values` e `variant_attribute_values`. `catalog_search_documents` e sinônimos atendem busca sem alterar o nome oficial.

## PIM_EXISTING_CAPABILITIES

- valores textuais, opções, números, medidas e medidas compostas;
- valor comercial preservado em `display_value`, inclusive `25mm x 1/2"`;
- componentes racionais auxiliares, sem float nem inferência silenciosa;
- assignments em produto e variant;
- aliases/sinônimos de busca, mappings externos e mídia por URL/metadata;
- catálogo staging documentado com 3.080 products/variants, 1.410 assignments mapeados, 237 ambíguos e 1 não mapeado.

Essas contagens são evidência documental das fases E/F. Não foram reconfirmadas no banco durante a auditoria inicial da P.1.

## PIM_MISSING_CAPABILITIES

Faltavam perfil editorial separado do source, workflow explícito, provenance/decisão por assignment, sugestões desacopladas, audit trail PIM, autorização e UI operacional administrativa.

## PIM_RECOMMENDED_CHANGES

A migration `20260827120000_pim_v1_foundation.sql` adiciona somente `pim_product_profiles`, `pim_attribute_reviews`, `pim_suggestions` e `pim_audit_log`, além de enums controlados. Não duplica atributos nem altera products, variants, preço ou estoque. Todas as novas tabelas usam RLS sem policy pública.

## Resultado dos gates de auditoria

- P1-A: schema compreendido por código, migrations e documentação.
- P1-B: aprovado no desenho; o modelo PIM tipado existente é reutilizado.
- Ausentes no repositório: `docs/database/24-runtime-integration-stage0.md` e `25-gate-a-reconvergence.md`.
