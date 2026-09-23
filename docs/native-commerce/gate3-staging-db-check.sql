-- Gate 3 — conferência read-only pós smoke test (rodar manualmente no SQL
-- Editor do Supabase, projeto de STAGING). Somente SELECTs de CONTAGEM:
-- nenhuma linha individual, nenhuma coluna de PII (nome/e-mail/telefone/
-- endereço/documento) é retornada por nenhuma consulta abaixo.
--
-- Antes de rodar, substitua os dois placeholders da CTE "params" pelos
-- valores que o script scripts/staging/gate3-cart-checkout-smoke-test.mjs
-- imprime ao final da execução ("cartId=..." / "checkoutId=...").
-- Esses dois UUIDs são o "run id" desta execução: nenhuma das consultas
-- abaixo varre a tabela inteira, todas filtram por eles.

with params as (
  select
    'COLE_AQUI_O_cartId'::uuid as cart_id,
    'COLE_AQUI_O_checkoutId'::uuid as checkout_id
)

-- 1) Carrinho: existe, status esperado, quantidade de itens (sem listar os itens).
select
  'carrinho' as verificacao,
  c.status,
  c.version,
  count(ci.id) as item_count
from params, carts c
left join cart_items ci on ci.cart_id = c.id
where c.id = params.cart_id
group by c.status, c.version;

-- 2) Estado do checkout: status, versão, se já expirou.
select
  'checkout_session' as verificacao,
  cs.status,
  cs.version,
  (cs.expires_at > now()) as ainda_nao_expirou,
  count(*) as n
from params, checkout_sessions cs
where cs.id = params.checkout_id
group by cs.status, cs.version, cs.expires_at;

-- 3) Reservas de estoque ligadas a este checkout: quantas ativas, quantas
--    já expiradas/liberadas/confirmadas — agrupado por status, sem listar
--    reserva por reserva.
select
  'inventory_reservations' as verificacao,
  ir.status,
  count(*) as n,
  min(ir.expires_at) as expira_mais_cedo,
  max(ir.expires_at) as expira_mais_tarde
from params
join checkout_session_items csi on csi.checkout_session_id = params.checkout_id
join inventory_reservations ir on ir.checkout_session_item_id = csi.id
group by ir.status;

-- 4) Pedidos criados a partir deste checkout — ESPERADO: 0 (o roteiro do
--    smoke test nunca chega a pagar/submeter; só chega até "ready").
select
  'orders' as verificacao,
  count(*) as orders_criados
from params, orders o
where o.checkout_session_id = params.checkout_id;

-- 5) Tentativas de pagamento ligadas a algum pedido deste checkout —
--    ESPERADO: 0, pelo mesmo motivo do item 4 (e trivialmente 0 se o item
--    4 já for 0, mas mantido como checagem independente).
select
  'payment_attempts' as verificacao,
  count(*) as payment_attempts_criados
from params
join orders o on o.checkout_session_id = params.checkout_id
join payment_attempts pa on pa.order_id = o.id;

-- 6) Eventos de observabilidade com PII — NÃO é possível verificar por SQL.
--    lib/observability/nativeCommerceEvents.ts grava eventos como linhas de
--    console.log/console.error no processo Node da Hostinger, não em uma
--    tabela do Postgres — não existe "observability_events" neste schema.
--    A checagem "zero PII nos eventos" (Passo 3 da autorização) só pode ser
--    feita lendo os logs de runtime do Node.js na Hostinger diretamente
--    (hosting_getNode_jsRuntimeLogsV1 ou o painel da Hostinger), procurando
--    por linhas "[native-commerce] native_checkout_pii_persisted" e
--    confirmando que os únicos campos presentes são identificadores
--    (checkoutId), nunca nome/e-mail/telefone/endereço/documento.
