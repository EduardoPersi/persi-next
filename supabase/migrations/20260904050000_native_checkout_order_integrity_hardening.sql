-- B.3-C3-P3-B local/dark hardening. No runtime activation or business-data mutation.

-- Store configuration is operational authority. Runtime roles read it, but only
-- the narrow order-number allocator may mutate its sequence as SECURITY DEFINER.
drop policy if exists stores_app on public.stores;
drop policy if exists stores_worker on public.stores;
revoke insert,update,delete,truncate,references,trigger on public.stores from persi_app,persi_worker;
grant select on public.stores to persi_app,persi_worker;
create policy stores_app_select on public.stores for select to persi_app using(true);
create policy stores_worker_select on public.stores for select to persi_worker using(true);

alter table public.inventory_reservations
  add column order_item_id uuid references public.order_items(id) on delete restrict;
create unique index inventory_reservations_order_item_level_unique
  on public.inventory_reservations(order_item_id,inventory_level_id)
  where order_item_id is not null;

create function public.validate_inventory_reservation_order_link()
returns trigger language plpgsql security invoker set search_path='' as $$
declare checkout_item public.checkout_session_items; order_item public.order_items; linked_order public.orders; level public.inventory_levels;
begin
  if new.order_item_id is not distinct from old.order_item_id then return new; end if;
  if old.order_item_id is not null then
    raise exception using errcode='23514',message='RESERVATION_LINK_CONFLICT';
  end if;
  if new.order_item_id is null then return new; end if;
  if old.status<>'active' or new.status<>'active' then
    raise exception using errcode='23514',message='RESERVATION_NOT_ACTIVE';
  end if;
  if old.expires_at<=transaction_timestamp() then
    raise exception using errcode='23514',message='RESERVATION_EXPIRED';
  end if;
  if old.checkout_session_item_id is null then
    raise exception using errcode='23514',message='RESERVATION_CHECKOUT_LINK_REQUIRED';
  end if;
  select * into checkout_item from public.checkout_session_items where id=old.checkout_session_item_id;
  select * into order_item from public.order_items where id=new.order_item_id;
  if not found then raise exception using errcode='23503',message='ORDER_ITEM_NOT_FOUND'; end if;
  select * into level from public.inventory_levels where id=old.inventory_level_id;
  select * into linked_order from public.orders where id=order_item.order_id;
  if level.product_variant_id is distinct from checkout_item.product_variant_id or
     level.product_variant_id is distinct from order_item.product_variant_id then
    raise exception using errcode='23514',message='RESERVATION_VARIANT_MISMATCH';
  end if;
  if old.quantity<>checkout_item.quantity or old.quantity<>order_item.quantity then
    raise exception using errcode='23514',message='RESERVATION_QUANTITY_MISMATCH';
  end if;
  if linked_order.checkout_session_id is null or linked_order.checkout_session_id<>checkout_item.checkout_session_id then
    raise exception using errcode='23514',message='RESERVATION_ORDER_SCOPE_MISMATCH';
  end if;
  return new;
end $$;

create trigger inventory_reservations_order_link_guard
before update of order_item_id on public.inventory_reservations
for each row execute function public.validate_inventory_reservation_order_link();

create function public.link_inventory_reservation_to_order_item(p_reservation_id uuid,p_order_item_id uuid)
returns public.inventory_reservations language plpgsql security definer set search_path='' as $$
declare reservation public.inventory_reservations;
begin
  select * into reservation from public.inventory_reservations where id=p_reservation_id for update;
  if not found then raise exception using errcode='P0002',message='RESERVATION_NOT_FOUND'; end if;
  if reservation.order_item_id=p_order_item_id then return reservation; end if;
  if reservation.order_item_id is not null then
    raise exception using errcode='23514',message='RESERVATION_LINK_CONFLICT';
  end if;
  update public.inventory_reservations set order_item_id=p_order_item_id,updated_at=now()
    where id=reservation.id returning * into reservation;
  return reservation;
end $$;

-- Fail migration rather than silently grandfathering incomplete historical orders.
do $$
begin
  if exists(
    select 1 from public.orders o where
      (select count(*) from public.order_status_events e
       where e.order_id=o.id and e.from_status is null and e.to_status='pending' and e.actor_type='system')<>1
  ) then raise exception using errcode='23514',message='EXISTING_ORDER_INITIAL_EVENT_INVALID'; end if;
end $$;

alter table public.order_status_events add constraint order_status_events_initial_exact_check
  check(from_status is not null or (to_status='pending' and actor_type='system'));

create function public.enforce_native_order_initial_event()
returns trigger language plpgsql security invoker set search_path='' as $$
declare target_order uuid; initial_count bigint; current_status public.order_status;
begin
  if tg_table_name='orders' then target_order:=new.id; else target_order:=new.order_id; end if;
  select status into current_status from public.orders where id=target_order;
  if not found then return null; end if;
  select count(*) into initial_count from public.order_status_events e
    where e.order_id=target_order and e.from_status is null and e.to_status='pending' and e.actor_type='system';
  if initial_count<>1 then raise exception using errcode='23514',message='ORDER_INITIAL_EVENT_REQUIRED'; end if;
  return null;
end $$;

create constraint trigger orders_initial_event_required
after insert on public.orders deferrable initially deferred
for each row execute function public.enforce_native_order_initial_event();
create constraint trigger order_events_initial_exact
after insert on public.order_status_events deferrable initially deferred
for each row when (new.from_status is null)
execute function public.enforce_native_order_initial_event();

revoke all on function public.validate_inventory_reservation_order_link(),
  public.link_inventory_reservation_to_order_item(uuid,uuid),
  public.enforce_native_order_initial_event() from public,anon,authenticated;
grant execute on function public.link_inventory_reservation_to_order_item(uuid,uuid) to persi_app;

comment on column public.inventory_reservations.order_item_id is 'One-time C3 ownership link to the exact order item; linking does not change stock or reservation state.';
comment on function public.link_inventory_reservation_to_order_item(uuid,uuid) is 'Owner-link primitive: locked, idempotent for the same pair, fail-closed for reassignment.';
