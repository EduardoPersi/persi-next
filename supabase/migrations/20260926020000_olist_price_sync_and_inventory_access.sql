-- Olist Fase 1 (read-only) -- price sync write path, inventory sync write
-- wrapper, and a read-only inventory-freshness check for the cart/checkout
-- live stock check.
--
-- Design: docs/native-commerce/olist-integration-design.md Sections 5.2,
-- 5.7, 14.3. NOT APPLIED to any real Supabase project by this round.
--
-- IMPORTANT, found by reading the existing functions before writing this
-- migration (not assumed): public.adjust_inventory
-- (20260823110400_inventory.sql) is declared `security invoker`, and
-- inventory_levels/inventory_movements have row level security enabled
-- with ZERO policies and no grant to any persi_* role. A bare
-- `grant execute on function adjust_inventory to persi_worker` -- the
-- literal instruction this migration was asked to implement -- would
-- compile but fail at call time with a permission-denied/RLS error, because
-- SECURITY INVOKER does not bypass RLS: persi_worker would still need
-- direct table-level access it doesn't have. The correct, minimal-blast-
-- radius fix (not touching adjust_inventory itself, per the project's own
-- rule against altering frozen migrations) is a thin SECURITY DEFINER
-- wrapper owned by postgres, which bypasses RLS by ownership the same way
-- every other native-commerce write path already does (see e.g.
-- consume_admin_rate_limit, create_native_cart).
create function public.sync_olist_inventory(
  p_inventory_level_id uuid,
  p_new_quantity_on_hand bigint,
  p_source_reference text,
  p_reason text default null
)
returns public.inventory_levels
language sql
security definer
set search_path = ''
as $$
  select * from public.adjust_inventory(p_inventory_level_id, p_new_quantity_on_hand, 'olist', p_source_reference, p_reason);
$$;

alter function public.sync_olist_inventory(uuid, bigint, text, text) owner to postgres;
revoke all on function public.sync_olist_inventory(uuid, bigint, text, text) from public, anon, authenticated;
-- persi_worker only: inventory sync is written by the webhook/varredura
-- worker (olist-integration-design.md Section 5.2/5.6), never by the
-- cart-check path, which only reads (see read_native_inventory_freshness
-- below) and never writes stock from a checkout request.
grant execute on function public.sync_olist_inventory(uuid, bigint, text, text) to persi_worker;

comment on function public.sync_olist_inventory(uuid, bigint, text, text) is
  'SECURITY DEFINER wrapper so persi_worker can call adjust_inventory (SECURITY INVOKER, no direct persi_* grant) with source_system fixed to olist.';

-- ---------------------------------------------------------------------------
-- Price sync write path -- no equivalent SQL function existed before this
-- migration (confirmed by grep across every migration): the PIM catalog
-- importer writes `prices` directly with an ambient DB identity today
-- (docs/database/26-price-history-single-writer.md). This is a new,
-- guarded write path for persi_worker specifically, mirroring
-- adjust_inventory's own guard-rail shape (validate, no-op if unchanged,
-- otherwise write) rather than a raw table grant.
-- ---------------------------------------------------------------------------
create function public.apply_olist_price_sync(
  p_product_variant_id uuid,
  p_price_list_id uuid,
  p_list_amount_minor bigint,
  p_sale_amount_minor bigint default null,
  p_sale_valid_from timestamptz default null,
  p_sale_valid_to timestamptz default null,
  p_currency char(3) default 'BRL'
)
returns public.prices
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.prices;
  result public.prices;
begin
  if p_list_amount_minor is null or p_list_amount_minor <= 0 then
    raise exception using errcode = '23514', message = 'olist_price_sync_invalid_list_amount';
  end if;
  if p_sale_amount_minor is not null and p_sale_amount_minor > p_list_amount_minor then
    raise exception using errcode = '23514', message = 'olist_price_sync_sale_above_list';
  end if;
  if p_sale_valid_from is not null and p_sale_valid_to is not null and p_sale_valid_from > p_sale_valid_to then
    raise exception using errcode = '23514', message = 'olist_price_sync_invalid_sale_window';
  end if;

  select * into existing
  from public.prices
  where product_variant_id = p_product_variant_id
    and price_list_id = p_price_list_id
    and status = 'active'
  order by valid_from desc
  limit 1
  for update;

  if not found then
    insert into public.prices (
      product_variant_id, price_list_id, list_amount_minor, sale_amount_minor,
      sale_valid_from, sale_valid_to, currency, status, source
    ) values (
      p_product_variant_id, p_price_list_id, p_list_amount_minor, p_sale_amount_minor,
      p_sale_valid_from, p_sale_valid_to, p_currency, 'active', 'olist'
    )
    returning * into result;
    return result;
  end if;

  if existing.list_amount_minor = p_list_amount_minor
     and existing.sale_amount_minor is not distinct from p_sale_amount_minor
     and existing.sale_valid_from is not distinct from p_sale_valid_from
     and existing.sale_valid_to is not distinct from p_sale_valid_to
     and existing.currency = p_currency then
    return existing;
  end if;

  update public.prices
  set list_amount_minor = p_list_amount_minor,
      sale_amount_minor = p_sale_amount_minor,
      sale_valid_from = p_sale_valid_from,
      sale_valid_to = p_sale_valid_to,
      currency = p_currency,
      source = 'olist',
      updated_at = now()
  where id = existing.id
  returning * into result;

  -- prices_capture_history (20260823110300_pricing.sql) fires automatically
  -- on this UPDATE and records the previous/new amounts -- never inserted
  -- into price_history directly here, per the single-writer rule that
  -- 20260827133500_price_history_single_writer_cleanup.sql was written to
  -- restore after a real duplicate-history bug.
  return result;
end;
$$;

alter function public.apply_olist_price_sync(uuid, uuid, bigint, bigint, timestamptz, timestamptz, char(3)) owner to postgres;
revoke all on function public.apply_olist_price_sync(uuid, uuid, bigint, bigint, timestamptz, timestamptz, char(3)) from public, anon, authenticated;
grant execute on function public.apply_olist_price_sync(uuid, uuid, bigint, bigint, timestamptz, timestamptz, char(3)) to persi_worker;

comment on function public.apply_olist_price_sync(uuid, uuid, bigint, bigint, timestamptz, timestamptz, char(3)) is
  'Guarded price write for Olist sync: validates amounts, no-ops if unchanged, never writes price_history directly (the existing trigger owns that).';

-- ---------------------------------------------------------------------------
-- Read-only inventory freshness, for the cart/checkout live stock check
-- (Section 5.7). Aggregates across every inventory_location for the
-- variant -- this schema allows more than one location per variant
-- (inventory_levels_variant_location_unique is per (variant, location),
-- not per variant alone) and this project's real setup is not assumed
-- here to be single-location.
-- ---------------------------------------------------------------------------
create function public.read_native_inventory_freshness(p_product_variant_id uuid)
returns table (
  quantity_on_hand bigint,
  quantity_reserved bigint,
  quantity_available bigint,
  last_synced_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    coalesce(sum(il.quantity_on_hand), 0),
    coalesce(sum(il.quantity_reserved), 0),
    coalesce(sum(il.quantity_available), 0),
    max(il.updated_at)
  from public.inventory_levels il
  where il.product_variant_id = p_product_variant_id;
$$;

alter function public.read_native_inventory_freshness(uuid) owner to postgres;
revoke all on function public.read_native_inventory_freshness(uuid) from public, anon, authenticated;
-- persi_app: this is the fallback path the cart/checkout live stock check
-- (running as persi_app, Section 5.7) reads when Olist is unreachable.
grant execute on function public.read_native_inventory_freshness(uuid) to persi_app, persi_worker;
