# Performance e fila — versão 0.7.0

## Diagnóstico da implementação anterior

A consulta de seleção já usava `LIMIT`, `wc_product_meta_lookup.global_unique_id` e um único `NOT EXISTS` indexável para excluir `OLIST_NO_GTIN`; ela não carregava os 3.080 produtos nem consultava auditoria por produto.

Os gargalos locais encontrados depois dessa consulta eram:

1. `wp_get_post_parent_id()` e `get_post_type()` para cada ID retornado, até duas consultas/cargas de cache por item.
2. Um `$wpdb->replace()` por `run_item`.
3. O retorno de `queue_ready()` ignorado, permitindo prosseguir quando uma migração incompleta impedia o update de `total_items`.
4. Três updates do run por produto no acompanhamento inicial.
5. Worker padrão de 50 produtos, potencialmente longo por depender de HTTP serial.

O estado `QUEUE_PREPARING / 0 de 0` após a abertura do modal é compatível com falha silenciosa no update do schema de progresso. `failed / 0` podia ser produzido por lock, inserção da fila ou agendamento sem persistir etapa e causa.

## Pipeline atual

- Validação explícita do schema antes do run.
- Seleção única e limitada retornando `ID`, `post_parent` e `post_type`.
- Exclusão de `OLIST_NO_GTIN` dentro da mesma query; índice `product_status (product_id,status)`.
- Um `INSERT ... VALUES` para toda a fila solicitada.
- Verificação dos retornos de seleção, inserção, update da fila e agendamento.
- `failure_stage`, `failure_code` e `failure_message` no run.
- Watchdog de 2 minutos ao reabrir o painel para preparação abandonada.
- Uma ação assíncrona por lote, nunca uma ação por produto.
- Lote padrão 20, distinto do limite do run, e orçamento padrão de 25 segundos.
- Watchdog autenticado no painel aciona um worker quando a fila permanece parada; um lock exclusivo por execução evita concorrência com o Action Scheduler.

## Olist

Para GTIN, a listagem `GET /produtos?codigo={SKU}` já devolve `id`, `sku` e `gtin`; portanto era e continua sendo uma chamada HTTP por produto sem cache. O detalhe não é necessário para GTIN.

O cache `{prefix}persi_catalog_olist_cache` guarda SKU, ID, snapshot e expiração. TTL padrão: 15 minutos. Dry Runs próximos reutilizam o snapshot. O detalhe de atributos também reutiliza e enriquece o mesmo snapshot quando disponível.

Não foi inventado endpoint batch. O cliente continua serial. Erros de transporte e 5xx têm somente uma repetição com atraso de 250 ms. 429 respeita `Retry-After` ou o reset informado, limitado a uma hora. Cinco `API_ERROR` consecutivos no mesmo worker abrem o circuito e falham o run com segurança.

## Instrumentação

Ative temporariamente fora do Git:

```php
define( 'PERSI_CATALOG_PERFORMANCE_DIAGNOSTICS', true );
```

O painel passa a mostrar total, amostras e média para as etapas efetivamente observadas: preparação, seleção, fila, agendamento, espera do primeiro worker, HTTP Olist, detalhe Olist, validação GTIN, leitura/escrita Woo, auditoria, contadores, item e run.

Não são registrados URLs completas, headers, tokens ou payloads.

## Benchmark seguro

Números reais dependem do banco, WP-Cron/Action Scheduler, rede e Olist de produção. O ambiente de desenvolvimento não possui WordPress, MariaDB, credenciais Olist nem PHP e, por isso, não produz números representativos.

Execute somente Dry Run, nesta ordem: 10, 50, 100 e, após revisão, 500. Registre a tabela de diagnóstico depois de cada run. Não compare runs quentes e frios sem indicar o efeito do cache.
