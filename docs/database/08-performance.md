# Performance e escalabilidade inicial

## Escala-alvo e princípios

Projetar para dezenas de milhares de produtos, múltiplas variants, crescimento
de pedidos/eventos e várias instâncias Next, sem sharding, Redis ou engine de
busca dedicada. Medir antes de criar índices/materializações adicionais.

## Queries críticas esperadas

| Query | Estratégia |
| --- | --- |
| Produto por slug publicado | unique/partial index em product slug + joins batch de variants/media/brand |
| Categoria paginada | product_categories/category + status/sort/id; keyset |
| Variant por SKU/GTIN | unique normalized indexes; GTIN parcial não nulo |
| Preço vigente | `(variant_id, price_list_id, valid_from)` e filtro de vigência |
| Estoque por variant/location | unique pair; seleção agregada limitada |
| Reserva | conditional update + row lock curto |
| Pedido por number/customer | unique order number; `(customer_id, created_at desc, id)` |
| Payment/provider reference | partial unique provider/reference |
| Inbox/outbox/jobs pendentes | partial `(status, available_at, id)` |
| Busca | generated/search document com GIN FTS; trigram nos termos selecionados |

FKs usadas em joins recebem índices explícitos; PostgreSQL não os cria
automaticamente. Não indexar todo status booleano isoladamente. Índices parciais
para filas ativas evitam crescimento desnecessário. Confirmar com `EXPLAIN
(ANALYZE, BUFFERS)` usando dados representativos antes de production.

## Paginação e N+1

- Listagens públicas usam keyset/cursor estável (`sort_key, id`) quando ordem
  permitir; offset fica para páginas administrativas pequenas e SEO paginado.
- Limites máximos server-side; nenhuma consulta “all products” no request.
- Buscar variants, preço vigente, mídia principal e disponibilidade por batch ou
  view/projeção, não uma query por card.
- DataLoader não corrige modelo ruim; primeiro compor SQL/joins adequados.
- Export/import usa cursor, lotes limitados e streaming quando apropriado.

## Busca PostgreSQL V1

- `unaccent` para normalização linguística e `pg_trgm` para typo/prefixo em
  nome, SKU e termos comerciais selecionados.
- FTS (`tsvector`) pondera nome/SKU/GTIN/marca acima de descrição/atributos.
- GIN para `tsvector` e trigrams realmente consultados; não duplicar índices.
- Sinônimos entram no documento/projeção de busca por job idempotente.
- Filtros usam colunas/joins estruturados do PIM, não parsing do texto.
- Atualização via outbox; job pode reconstruir toda a projeção.
- Avaliar engine dedicada somente após evidência de relevância/latência/volume
  que PostgreSQL não atenda.

## Connections e transações

- Singleton de cliente/pool por processo; nunca conexão nova por request.
- Runtime efêmero: Supavisor transaction mode, prepared statements desligados.
- Runtime persistente: direct se rede/IPv6 permitir; session pooler como opção
  IPv4; confirmar Hostinger e plano antes da Fase C.
- Migrations/dump/restore: direct connection separada.
- Pool pequeno por instância, somado ao número máximo de instâncias e serviços
  Supabase; configurar timeouts e observar saturação.
- Transações de estoque/checkout curtas, sem chamada HTTP externa dentro do lock.

## Cache e consistência

Cacheáveis: produto publicado, categoria, marca, SEO, navegação e mídia. Usar
Next cache/revalidation com tags por entidade/lista; outbox dispara invalidação
após commit. TTL atua como rede de segurança.

Sensíveis: preço final, estoque, cart, order, payment, idempotency, inbox/outbox.
Não usar cache público. Página pode mostrar projeção cacheada informativa, mas
checkout sempre recalcula preço/estoque/frete no servidor. Cart/account continuam
`private, no-store` como hoje. Redis não entra na V1.

## Crescimento e retenção

- `price_history`, movements, status history, inbox/outbox, jobs e audit são
  append-heavy. Definir retenção/arquivamento por tabela antes de production.
- Processed inbox/outbox pode ser particionada por tempo somente quando métricas
  mostrarem necessidade; não particionar inicialmente.
- Payload mínimo; blobs/mídia ficam em storage, não em linhas do banco.
- Vacuum/analyze e bloat são monitorados pelo serviço; não presumir tuning do
  plano sem verificação.

## Limites e observabilidade

Definir budgets iniciais medidos em staging: p95/p99 por caso de uso, timeout de
query, tempo de lock, pool wait, deadlocks, rows scanned/returned, cache hit,
backlog/idade de jobs e tamanho de tabelas/índices. Slow queries têm correlation
ID sem parâmetros sensíveis.

Alertar por: pool próximo do limite, lock/deadlock, replica/storage pressure,
erro/latência de query, backlog inbox/outbox, falhas de retry e divergência de
reconciliação. Testar concorrência de reserva e checkout com múltiplas instâncias.

## Antipadrões proibidos

- `SELECT *` em paths críticos; paginação ilimitada; N+1;
- índice especulativo em cada coluna;
- chamadas a provider durante transação/lock;
- cache público de dados privados/transacionais;
- JSONB genérico para escapar do modelo;
- otimização sem plano de consulta/dados representativos.
