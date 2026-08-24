# Preflight do catálogo completo — Fase E.4

## Resultado executivo

Performance Gate aprovado. Full Preflight Gate reprovado por conflitos conhecidos de
preço e GTIN. O staging permanece com 100 produtos; os 2.980 restantes não foram escritos.

| Métrica | Resultado |
| --- | ---: |
| Produtos examinados | 3.080 |
| Default variants esperadas | 3.080 |
| SKU válido/ausente/duplicado | 3.080 / 0 / 0 |
| GTIN distinto presente | 2.885 |
| GTIN ausente | 152 |
| Ocorrências duplicadas | 29 |
| Conflitos entre fontes GTIN | 14 |
| Marcas/categorias | 153 / 320 |
| Referências de mídia | 6.324 |
| Preço regular/sale price | 3.080 / 186 |
| Preços não representáveis em centavos | 197 |
| PIM mapped/unmapped/ambiguous | 1.410 / 1 / 237 |
| Fora de estoque | 736 |

Os Woo IDs e valores completos ficam no relatório local ignorado pelo Git em
`supabase/.temp/catalog-import/full-preflight.json`.

## Checkpoint, falhas e resume

O checkpoint JSON não contém credencial e usa gravação temporária seguida de rename. Ele
registra run ID, source, target, timestamps, página, contadores, IDs concluídos e falhas
classificadas. Resume calcula somente IDs pendentes. O teste start → process → save → reload
→ resume passou sem duplicar o item concluído.

- record error: rollback do agregado, registrar e continuar conforme severidade;
- system error: abortar imediatamente;
- source 429/5xx: retry/backoff e abortar após o limite;
- checkpoint: a cada 50 produtos com reconciliação incremental;
- espaço: WARN 300 MiB, STOP 400 MiB, referência Free 500 MB.

## Rollback futuro

Não resetar o banco. Registrar proveniência do run e usar mappings Woo para identificar
produtos criados. Remover em ordem de dependências apenas entidades não compartilhadas;
categorias, marcas, mídia e PIM exigem contagem de referências. Preservar os 100 UUIDs já
aprovados. Nenhum rollback foi executado nesta fase.

## Tempo e capacidade

O baseline no-op equivale a 24,2 min em concorrência 1, 12,3 min em 2 e 6,3 min em 4. O
benchmark misto projeta aproximadamente 61 min em concorrência 1. A configuração inicial
recomendada é concorrência 1 e checkpoint 50.

O banco permanece com 15.166.611 bytes, aproximadamente 3,0% de 500 MB decimais. A projeção
de 46,6 MiB para 3.080 equivale a aproximadamente 9,8%. Históricos e ledgers devem ser monitorados
separadamente.

## Decisões humanas pendentes

1. Fonte ou regra autorizada de arredondamento para 197 preços fracionários.
2. Política para 29 repetições de GTIN diante da restrição UNIQUE.
3. Escolha da fonte correta nos 14 conflitos de GTIN.
4. Tratamento comercial do tamanho concatenado do Woo ID 9043.

Até essas decisões serem implementadas e testadas, a importação completa não é segura.

## Fechamento pós-política — Fase E.5

As três decisões bloqueantes da E.4 foram implementadas e testadas: preços usam conversão
decimal exata `HALF UP`; conflitos de fonte usam `global_unique_id`; grupos duplicados
ficam com GTIN operacional `NULL`, sem escolher proprietário por heurística. O tamanho
concatenado do Woo ID 9043 continua preservado como PIM não mapeado e não é bloqueante.

O novo full dry-run GET-only processou 3.080 produtos em 38 requests, sem retry, em 37,469
segundos. Resultado: 3.080 SKUs válidos e únicos; 197 preços resolvidos; 14/14 conflitos de
fonte resolvidos; 27/27 grupos duplicados neutralizados; 208 GTINs operacionais `NULL`;
1.410 valores PIM mapeados, um não mapeado e 237 ambíguos; zero registro inválido e zero
conflito bloqueante. O staging continua com os mesmos 100 produtos da E.4.

A carga completa está tecnicamente apta a ser autorizada em etapa separada, usando
concorrência 1 e checkpoint 50. Nenhuma carga completa foi executada na E.5.

## Execução autorizada — E.6

A autorização foi exercida no staging: 3.080/3.080 produtos e variants foram importados e
reconciliados, sem divergência crítica, órfão ou duplicata. A segunda passagem comprovou
idempotência física com zero write e zero crescimento. Este documento permanece como
registro do preflight; o relatório operacional completo está em `16-full-catalog-import.md`.
