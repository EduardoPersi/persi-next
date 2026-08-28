# F.4.2A/F.4.2B — Controlled reconvergence e Gate A

## Diagnóstico e reconvergência

A auditoria confrontou os 3.080 produtos do WooCommerce com a réplica PostgreSQL. Na F.4.2A, 13 alterações de origem pendentes e uma divergência adicional de preço (Woo ID 14806, `7100 → 8835`) foram reconciliadas pelo pipeline oficial. A segunda passagem gerou zero writes.

Na retomada F.4.2B, foi encontrada uma alteração de estoque e, em seguida, 59 alterações de associação a categorias. Todas tinham `date_modified_gmt` do Woo posterior a `external_mapping.source_changed_at` e foram classificadas como `UNSYNCED_SOURCE_CHANGE`; não houve casos `UNKNOWN`. O pipeline oficial aplicou 60 updates no total desta retomada, sem inserts, falhas, conflitos ou retries. As segundas passagens geraram zero inserts, updates e deletes.

Não foi criado nenhum movimento artificial de estoque. WooCommerce permaneceu como autoridade, e PostgreSQL como réplica.

## Resultado final do Gate A

- Paridade integral: 3.080/3.080.
- Severidades Critical/High/Medium/Low: 0/0/0/0.
- Diferenças comerciais e de taxonomy/media: 0.
- Category/brand/search DTO parity: PASS.
- Search golden: 14/14.
- Filtros: 7/7; ordering: 6/6; paginação: PASS.
- `source_changed_at`: PASS.
- Inbox: 177 processados, 0 pending, 0 dead-letter.
- RLS: 27/27; policies públicas: 0.
- Banco: 55,1 MiB.
- Filtro PostgreSQL: p50 17,96 ms; p95 56,86 ms.
- Shadow-read PostgreSQL: produto p50/p95 22,2/37,4 ms; SKU 22,5/31,8 ms; categoria 25,9/28,2 ms; marca 21,6/34,2 ms; busca 33,6/41,2 ms.
- Readiness agregado: todos os 11 gates aprovados (`canaryReady: YES`).

O readiness aprovado não autoriza execução: Gate B, Stage 0, canário, deploy, variáveis de runtime, scheduler e webhook permanecem não executados.

## Price history

O blocker de responsabilidade duplicada foi corrigido na F.4.2B. O trigger PostgreSQL passou a ser o único writer automático; detalhes e evidências estão em `docs/database/26-price-history-single-writer.md`.

