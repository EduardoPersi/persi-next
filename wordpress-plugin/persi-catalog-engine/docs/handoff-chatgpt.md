# Especificação para continuidade no ChatGPT

## Estado entregue

O Persi Catalog Engine 0.8.0 sincroniza GTIN e mantém atributos somente em diagnóstico. A correspondência é estrita por SKU, o destino é `WC_Product::set_global_unique_id()`, e toda escrita exige modo real mais a confirmação `SINCRONIZAR`. O painel prepara a fila por critério automático ou por seleção manual pesquisável; o plugin não adiciona colunas nem ação em massa à lista de produtos.

A seleção é temporária por usuário durante 30 minutos. Ao iniciar, ela vira uma fila durável em `{prefix}persi_catalog_run_items`. Produtos simples viram um alvo; produtos variáveis viram um alvo para cada variação. A fila já possui `modules`, atualmente fixado em `gtin`.

## Próxima fase solicitada

Adicionar módulos separados para marca e atributos sem alterar a segurança do GTIN:

1. Consultar o detalhe do produto Olist pelo ID obtido da correspondência exata de SKU.
2. Ler a marca estruturada do Olist; não inferir marca para escrita a partir do nome ou descrição.
3. Usar `product_brand` como destino autoritativo da marca no produto pai.
4. Oferecer espelhamento opcional em `pa_marca`, desativado por padrão, para compatibilidade com o cadastro antigo.
5. Criar aliases revisáveis quando nomes diferirem, sem criar termos automaticamente durante o Dry Run.
6. Para atributos, mapear explicitamente cada campo Olist para uma taxonomia global `pa_*`; não criar atributos locais silenciosamente.
7. Descrição pode produzir apenas sugestões, marcadas com fonte, confiança e necessidade de aprovação humana.
8. Implementar seleção de módulos por execução (`gtin`, `brand`, `attributes`) e persistir isso na fila.
9. Manter logs separados por campo, valor anterior, valor proposto, fonte e status.
10. Exigir Dry Run e confirmação tipada para qualquer escrita real.

## Estados mínimos futuros

`BRAND_WOULD_UPDATE`, `BRAND_UPDATED`, `BRAND_ALREADY_SYNCED`, `BRAND_CONFLICT`, `OLIST_NO_BRAND`, `BRAND_MAPPING_REQUIRED`, `ATTRIBUTE_WOULD_UPDATE`, `ATTRIBUTE_UPDATED`, `ATTRIBUTE_CONFLICT`, `ATTRIBUTE_MAPPING_REQUIRED`.

## Regras que não podem ser quebradas

- Nunca substituir valor preenchido e divergente sem resolução explícita de conflito.
- Nunca relacionar produto por nome; somente SKU exato.
- Nunca gravar GTIN do pai em todas as variações.
- Marca é aplicada ao produto pai; atributos de variação somente na variação correspondente.
- Não expor tokens ou segredos em tela, log ou Git.
- Não executar automaticamente por `save_post_product`.
- Processar via Action Scheduler, com lock, lotes, retomada e auditoria.
- Preservar a taxonomia oficial `product_brand`, utilizada pelo WooCommerce e pelo front-end headless.

## Critérios de aceite

- Dry Run demonstra exatamente quais campos mudariam e em quais produtos.
- Seleção em massa não escreve nada antes da confirmação no painel.
- Produtos simples, pais e variações seguem as regras de destino acima.
- Reprocessamento pode ser filtrado por módulo, sem repetir consultas vazias de outro módulo.
- Testes cobrem permissão, nonce, SKU exato, conflitos, produto variável, fila persistida e ausência de escrita no Dry Run.
