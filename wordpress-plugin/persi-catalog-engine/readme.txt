=== Persi Catalog Engine ===
Contributors: persi
Requires at least: 7.0
Requires PHP: 8.1
Requires Plugins: woocommerce
Stable tag: 1.2.1
License: Proprietary

Sincronização conservadora e auditável de GTIN do Olist ERP para global_unique_id do WooCommerce.

== Fase 1 ==

* Correspondência estrita por SKU; nunca por nome.
* GTIN-8, GTIN-12, GTIN-13 e GTIN-14 com dígito verificador.
* Dry Run sem escrita.
* Seleção padrão somente de produtos e variações sem GTIN.
* Histórico evita repetir itens cujo Olist já respondeu sem GTIN; reprocessamento continua disponível manualmente.
* Conflitos nunca são sobrescritos.
* Produtos simples e variações são tratados como itens independentes.
* Processamento manual em lotes pelo Action Scheduler.
* Logs em tabela própria, sem tokens ou segredos.
* Seleção manual no painel por pesquisa local AJAX de nome ou SKU, sem carregar o catálogo inteiro.
* Filtros locais opcionais por categoria e marca, multisseleção e revisão dos alvos reais.
* Produtos variáveis usam o pai para Atributos e apenas variações com SKU para GTIN.
* Módulos são persistidos por item da fila; uma execução somente Atributos independe do GTIN.
* Colunas GTIN e Marca na lista de produtos; marca é apenas informativa nesta versão.
* Diagnóstico Olist somente leitura, com resposta sanitizada e inventário dos caminhos reais.
* Inventário de atributos globais WooCommerce sem criação ou alteração.
* Módulo Atributos em Discovery/Dry Run com candidatos, origem, evidência, confiança e status.
* Regras iniciais condicionadas à família para disjuntores, tubos, conexões, lâmpadas e bombas.
* Fila persistente preparada para todas as execuções, com total real e progresso recuperável.
* Modal de progresso local consultado a cada 2 segundos, sem depender do navegador para processar.
* Não adiciona colunas próprias à lista de produtos; utiliza as visualizações nativas do WooCommerce.
* Seleção limitada em SQL sem N+1 e inserção da fila em bulk.
* Worker padrão de 20 itens com orçamento de 25 segundos e continuação assíncrona.
* Cache temporário SKU → snapshot Olist, com TTL padrão de 15 minutos.
* Diagnóstico opcional por `hrtime(true)` e falhas de preparação explicitamente registradas.
* Cancelamento seguro pelo modal, com interrupção da fila e remoção das continuações agendadas.
* Continuação de lotes compatível com o Action Scheduler enquanto a ação anterior ainda está finalizando.
* Watchdog do painel aciona imediatamente workers parados, com lock exclusivo contra processamento duplicado.
* Lote padrão de 20 itens e orçamento de 25 segundos para reduzir a espera entre continuações.
* Interface operacional em português e confirmação da sincronização real por caixa de seleção.
* Limite solicitado e total elegível são preservados separadamente e exibidos no progresso.
* Attribute Discovery Engine determinístico v2 com famílias, normalização, contexto, conflitos, filtros e evidências auditáveis.
* Atributos permanecem exclusivamente em Simulação, sem qualquer rotina de escrita no WooCommerce.

== Changelog ==

= 1.2.1 =
* Dá precedência à medida comercial composta sobre as bitolas contidas no mesmo trecho do título.
* Registra spans consumidos com `COMPOSITE_CONSUMES_COMPONENTS`, preservando medidas simples e independentes fora do match.
* Melhora os rótulos administrativos dos estados de candidato, termo existente e destino a definir.

= 1.2.0 =
* Descobre medidas comerciais compostas de conexões hidráulicas sem escrever no WooCommerce.
* Preserva as bitolas individuais e registra também a composição ordenada em `medida_composta`.
* Normaliza medidas métricas, imperiais e mistas com propagação contextual de unidade auditável.
* Sugere a taxonomia planejada `pa_medida` e informa quando o destino ainda não existe.
* Mantém aliases apenas para busca e equivalência, sem criar termos duplicados.

= 1.1.1 =
* Adiciona diagnóstico Olist sanitizado por etapa, HTTP, tentativa e endpoint lógico.
* Evita apagar o refresh token após HTTP 401 e aplica retry transitório com backoff e jitter.
* Preserva a descoberta local de atributos e conclui execuções combinadas parcialmente quando o GTIN falhar.
* Corrige bitolas inteiras em polegadas e resolve automaticamente bitola por conceito e unidade.
* Adiciona diagnóstico opcional de medidas rejeitadas por contexto.

= 1.1.0 =
* Evolui o Attribute Discovery Engine para o ruleset 2.1.0.
* Adiciona resolução de termos Woo existentes com cache por taxonomia.
* Preserva CV, HP, W, kW, VA e kVA sem conversões silenciosas.
* Adiciona fase, seção do condutor, cores compostas e bitolas mistas.
* Mantém Atributos estritamente em diagnóstico, sem escrita no WooCommerce.

== Fase 2 ==

Use WooCommerce > Diagnóstico Olist para consultar um produto por ID WooCommerce ou SKU e descobrir o contrato real retornado pela conta. A resposta não é persistida.

Use WooCommerce > Atributos para revisar o inventário global e os candidatos da última execução. O módulo Atributos não possui código de escrita, não cria taxonomias, termos ou atributos e não modifica variações.

== Configuração ==

Defina fora do Git, preferencialmente em wp-config.php:

define( 'PERSI_CATALOG_OLIST_CLIENT_ID', 'valor-do-aplicativo' );
define( 'PERSI_CATALOG_OLIST_CLIENT_SECRET', 'segredo-do-aplicativo' );

Opcionalmente, altere o lote interno (padrão 20, máximo 100):

define( 'PERSI_CATALOG_BATCH_SIZE', 20 );

Para diagnóstico temporário de performance:

define( 'PERSI_CATALOG_PERFORMANCE_DIAGNOSTICS', true );

Opcionalmente ajuste o orçamento do worker e TTL do cache:

define( 'PERSI_CATALOG_WORKER_BUDGET_SECONDS', 25 );
define( 'PERSI_CATALOG_OLIST_CACHE_TTL', 900 );

Cadastre no aplicativo Olist a URL de retorno exibida pelo WordPress:

/wp-admin/admin-post.php?action=persi_catalog_olist_callback

Depois, em WooCommerce > Persi Catálogo, conecte a conta e execute primeiro um Dry Run limitado a 10 itens, com a seleção "Sem GTIN — ignorar os já encontrados vazios no Olist".

== Segurança operacional ==

Não ative sincronização real antes de revisar os 10 resultados do primeiro Dry Run. Para iniciar uma execução real, o operador precisa selecionar o modo correspondente e digitar SINCRONIZAR.
