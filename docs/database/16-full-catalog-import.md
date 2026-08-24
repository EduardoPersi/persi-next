# Full catalog import — Fase E.6

## Run

- Run ID: `catalog-full-20260824021524692-bd8142d7-3211-4a90-b784-1efe748e4036`.
- Início: 2026-08-24 02:15:24 UTC.
- Fim: 2026-08-24 03:18:43 UTC.
- Concorrência: 1.
- Checkpoint: 50 produtos; 62 checkpoints planejados, com último lote de 30.
- Fonte: WooCommerce exclusivamente GET.
- Destino: `persi-staging` no project ref aprovado.
- Schema: 7 migrations.

O checkpoint usa arquivo temporário seguido de rename, registra os 3.080 IDs concluídos e
não contém credenciais. Uma interrupção real ocorreu em 1.150 produtos e o mesmo run foi
retomado sem reiniciar do zero.

## Baseline e resultado

| Entidade | Antes | Após primeira passagem | Após segunda passagem |
| --- | ---: | ---: | ---: |
| Products | 100 | 3.080 | 3.080 |
| Variants | 100 | 3.080 | 3.080 |
| Brands usadas | 88 | 149 | 149 |
| Categories usadas | 172 | 291 | 291 |
| Media assets únicos | 244 | 6.298 | 6.298 |
| Product media | 244 | 6.324 | 6.324 |
| Attributes | 11 | 11 | 11 |
| Attribute values | 26 | 81 | 81 |
| PIM assignments | 70 | 1.410 | 1.410 |
| Prices | 100 | 3.080 | 3.080 |
| Inventory levels | 100 | 3.080 | 3.080 |
| Inventory movements | 0 | 0 | 0 |
| External mappings | 704 | 12.898 | 12.898 |
| Database bytes | 15.166.611 | 35.286.163 | 35.286.163 |

As 149 marcas e 291 categorias são as entidades efetivamente referenciadas pelos produtos.
A origem possui 153 marcas e 320 categorias cadastradas; quatro marcas e 29 categorias sem
uso não foram materializadas. As 6.324 referências de mídia resolvem para 6.298 assets
únicos porque uma imagem pode ser compartilhada. Binários não foram copiados.

## Catálogo e qualidade

- 3.080 produtos simples e 3.080 default variants reconciliados individualmente.
- 2.980 produtos novos; 100 produtos existentes reutilizados.
- Quatro produtos existentes receberam update por mudança real da origem; 96 foram no-op.
- 200/200 mappings originais de product/variant preservaram UUID.
- SKU ausente/duplicado: 0/0.
- GTIN operacional `NULL`: 208; GTIN não nulo duplicado: 0.
- Preços inválidos ou divergências comerciais: 0.
- PIM mapped/unmapped/ambiguous: 1.410/1/237.
- Produtos sem imagem: 1; média de 2,05 referências por produto.
- Primary category permaneceu `NULL`.

Os 237 valores ambíguos e o valor unmapped do Woo ID 9043 permanecem classificados e
auditáveis. Frações/display de origem foram preservados no relatório; zero measurement
component foi inventado no banco.

## Incidente e resume

Os Woo IDs 16339 e 16337 foram revertidos individualmente porque seus slugs brutos violavam
a constraint canônica do schema. O job abortou no checkpoint conforme projetado. A causa
foi corrigida de forma versionada no ETL: slug de produto passa pelo normalizador existente.
Após 365 testes, typecheck e lint específico, o mesmo run retomou os dois record errors e
continuou do checkpoint. Nenhuma constraint ou migration foi alterada.

## Reconciliação, integridade e idempotência

As duas reconciliações integrais verificaram 3.080/3.080 agregados, com zero produto ou
campo crítico divergente. As auditorias retornaram zero órfão de variant, preço, inventário,
mapping, mídia ou PIM e zero duplicata de mapping, SKU, GTIN não nulo, preço ativo, relação
de categoria ou mídia.

A segunda passagem durou 1.352.199 ms, produziu 56.590 no-ops, zero INSERT, zero UPDATE e
zero DELETE. O banco cresceu zero byte. Não houve histórico artificial, reservation ou
inventory movement.

## Performance e capacidade

O tempo ativo acumulado da primeira passagem, incluindo o trecho retomado, foi 2.444.498 ms
(40 min 44,498 s), throughput de 75,6 produtos/min. No segmento retomado, p50 foi 699 ms,
p95 948 ms e o mais lento foi o Woo ID 8864, com 1.441 ms; mídia foi sua fase dominante.
O run completo de relógio, incluindo diagnóstico/correção e segunda passagem, durou cerca
de 63 min 19 s. Woo teve zero retry no run retomado.

O crescimento da primeira passagem foi 20.119.552 bytes, aproximadamente 6.752 bytes por
novo produto. O resultado de 33,7 MiB ficou muito abaixo de WARN 300 MiB e STOP 400 MiB.

## Backlog remanescente

- 27 grupos de GTIN duplicado para saneamento futuro; permanecem `NULL`.
- Um valor PIM unmapped (`tamanho`, Woo ID 9043).
- 237 valores PIM ambíguos, sem inferência automática.

Não houve cutover. Next de produção, WooCommerce, Olist, checkout, clientes, pedidos,
pagamentos e produção não foram alterados.
