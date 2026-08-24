create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_-]*$'),
  name text not null check (length(btrim(name)) between 1 and 150),
  status public.record_status not null default 'draft',
  is_physical boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_code_unique unique (code)
);

create table public.inventory_levels (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  inventory_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  quantity_on_hand bigint not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved bigint not null default 0 check (quantity_reserved >= 0),
  quantity_available bigint generated always as (quantity_on_hand - quantity_reserved) stored,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_levels_variant_location_unique unique (product_variant_id, inventory_location_id),
  constraint inventory_levels_reservation_check check (quantity_reserved <= quantity_on_hand)
);

create index inventory_levels_location_variant_idx
  on public.inventory_levels (inventory_location_id, product_variant_id);

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  inventory_level_id uuid not null references public.inventory_levels(id) on delete restrict,
  quantity bigint not null check (quantity > 0),
  status public.inventory_reservation_status not null default 'active',
  reference_type text not null check (reference_type ~ '^[a-z][a-z0-9_.-]*$'),
  reference_id text not null check (length(btrim(reference_id)) between 1 and 200),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz,
  confirmed_at timestamptz,
  constraint inventory_reservations_expiry_check check (expires_at > created_at),
  constraint inventory_reservations_idempotency_unique unique (idempotency_key)
);

create index inventory_reservations_active_expiry_idx
  on public.inventory_reservations (expires_at, id)
  where status = 'active';
create index inventory_reservations_level_status_idx
  on public.inventory_reservations (inventory_level_id, status, id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_level_id uuid not null references public.inventory_levels(id) on delete restrict,
  reservation_id uuid references public.inventory_reservations(id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  quantity_on_hand_delta bigint not null default 0,
  quantity_reserved_delta bigint not null default 0,
  quantity_on_hand_after bigint not null check (quantity_on_hand_after >= 0),
  quantity_reserved_after bigint not null check (quantity_reserved_after >= 0),
  source_system text not null check (length(btrim(source_system)) between 1 and 50),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 200),
  reason text,
  created_at timestamptz not null default now(),
  constraint inventory_movements_nonzero_check check (
    quantity_on_hand_delta <> 0 or quantity_reserved_delta <> 0
  ),
  constraint inventory_movements_after_check check (
    quantity_reserved_after <= quantity_on_hand_after
  ),
  constraint inventory_movements_source_unique unique (source_system, source_reference, movement_type)
);

create index inventory_movements_level_created_idx
  on public.inventory_movements (inventory_level_id, created_at desc, id);
create index inventory_movements_reservation_idx
  on public.inventory_movements (reservation_id) where reservation_id is not null;

create function public.reserve_inventory(
  p_inventory_level_id uuid,
  p_quantity bigint,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_source_system text default 'persi'
)
returns public.inventory_reservations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.inventory_reservations;
  reserved public.inventory_reservations;
  level_after public.inventory_levels;
begin
  if p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'reservation_quantity_must_be_positive';
  end if;
  if p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'reservation_expiry_must_be_future';
  end if;

  select * into existing
  from public.inventory_reservations
  where idempotency_key = p_idempotency_key;

  if found then
    if existing.inventory_level_id <> p_inventory_level_id
      or existing.quantity <> p_quantity
      or existing.reference_type <> p_reference_type
      or existing.reference_id <> p_reference_id then
      raise exception using errcode = '23505', message = 'idempotency_key_payload_conflict';
    end if;
    return existing;
  end if;

  update public.inventory_levels
  set quantity_reserved = quantity_reserved + p_quantity,
      version = version + 1,
      updated_at = now()
  where id = p_inventory_level_id
    and quantity_on_hand - quantity_reserved >= p_quantity
  returning * into level_after;

  if not found then
    raise exception using errcode = 'P0001', message = 'insufficient_inventory';
  end if;

  insert into public.inventory_reservations (
    inventory_level_id, quantity, reference_type, reference_id, idempotency_key, expires_at
  ) values (
    p_inventory_level_id, p_quantity, p_reference_type, p_reference_id, p_idempotency_key, p_expires_at
  ) returning * into reserved;

  insert into public.inventory_movements (
    inventory_level_id, reservation_id, movement_type,
    quantity_on_hand_delta, quantity_reserved_delta,
    quantity_on_hand_after, quantity_reserved_after,
    source_system, source_reference
  ) values (
    p_inventory_level_id, reserved.id, 'reservation',
    0, p_quantity, level_after.quantity_on_hand, level_after.quantity_reserved,
    p_source_system, p_idempotency_key
  );

  return reserved;
end;
$$;

create function public.release_inventory_reservation(
  p_reservation_id uuid,
  p_source_reference text,
  p_source_system text default 'persi'
)
returns public.inventory_reservations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reservation public.inventory_reservations;
  level_after public.inventory_levels;
begin
  select * into reservation
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'reservation_not_found';
  end if;
  if reservation.status <> 'active' then
    return reservation;
  end if;

  update public.inventory_levels
  set quantity_reserved = quantity_reserved - reservation.quantity,
      version = version + 1,
      updated_at = now()
  where id = reservation.inventory_level_id
    and quantity_reserved >= reservation.quantity
  returning * into level_after;

  if not found then
    raise exception using errcode = '23514', message = 'inventory_reservation_invariant_broken';
  end if;

  update public.inventory_reservations
  set status = 'released', released_at = now(), updated_at = now()
  where id = reservation.id
  returning * into reservation;

  insert into public.inventory_movements (
    inventory_level_id, reservation_id, movement_type,
    quantity_on_hand_delta, quantity_reserved_delta,
    quantity_on_hand_after, quantity_reserved_after,
    source_system, source_reference
  ) values (
    reservation.inventory_level_id, reservation.id, 'release',
    0, -reservation.quantity, level_after.quantity_on_hand, level_after.quantity_reserved,
    p_source_system, p_source_reference
  );

  return reservation;
end;
$$;

create function public.confirm_inventory_reservation(
  p_reservation_id uuid,
  p_source_reference text,
  p_source_system text default 'persi'
)
returns public.inventory_reservations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reservation public.inventory_reservations;
  level_after public.inventory_levels;
begin
  select * into reservation from public.inventory_reservations
  where id = p_reservation_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'reservation_not_found';
  end if;
  if reservation.status <> 'active' then
    return reservation;
  end if;

  update public.inventory_levels
  set quantity_on_hand = quantity_on_hand - reservation.quantity,
      quantity_reserved = quantity_reserved - reservation.quantity,
      version = version + 1,
      updated_at = now()
  where id = reservation.inventory_level_id
    and quantity_on_hand >= reservation.quantity
    and quantity_reserved >= reservation.quantity
  returning * into level_after;
  if not found then
    raise exception using errcode = '23514', message = 'inventory_confirmation_invariant_broken';
  end if;

  update public.inventory_reservations
  set status = 'confirmed', confirmed_at = now(), updated_at = now()
  where id = reservation.id returning * into reservation;

  insert into public.inventory_movements (
    inventory_level_id, reservation_id, movement_type,
    quantity_on_hand_delta, quantity_reserved_delta,
    quantity_on_hand_after, quantity_reserved_after,
    source_system, source_reference
  ) values (
    reservation.inventory_level_id, reservation.id, 'sale',
    -reservation.quantity, -reservation.quantity,
    level_after.quantity_on_hand, level_after.quantity_reserved,
    p_source_system, p_source_reference
  );
  return reservation;
end;
$$;

create function public.adjust_inventory(
  p_inventory_level_id uuid,
  p_new_quantity_on_hand bigint,
  p_source_system text,
  p_source_reference text,
  p_reason text default null
)
returns public.inventory_levels
language plpgsql
security invoker
set search_path = ''
as $$
declare
  level_before public.inventory_levels;
  level_after public.inventory_levels;
begin
  select * into level_before from public.inventory_levels
  where id = p_inventory_level_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inventory_level_not_found';
  end if;
  if p_new_quantity_on_hand < level_before.quantity_reserved then
    raise exception using errcode = '23514', message = 'adjustment_below_reserved_inventory';
  end if;
  if p_new_quantity_on_hand = level_before.quantity_on_hand then
    return level_before;
  end if;

  update public.inventory_levels
  set quantity_on_hand = p_new_quantity_on_hand,
      version = version + 1,
      updated_at = now()
  where id = p_inventory_level_id returning * into level_after;

  insert into public.inventory_movements (
    inventory_level_id, movement_type, quantity_on_hand_delta, quantity_reserved_delta,
    quantity_on_hand_after, quantity_reserved_after, source_system, source_reference, reason
  ) values (
    p_inventory_level_id,
    (case when p_source_system = 'olist' then 'erp_sync' else 'adjustment' end)::public.inventory_movement_type,
    p_new_quantity_on_hand - level_before.quantity_on_hand, 0,
    level_after.quantity_on_hand, level_after.quantity_reserved,
    p_source_system, p_source_reference, p_reason
  );
  return level_after;
end;
$$;

create trigger inventory_locations_set_updated_at before update on public.inventory_locations
for each row execute function public.set_updated_at();
create trigger inventory_levels_set_updated_at before update on public.inventory_levels
for each row execute function public.set_updated_at();
create trigger inventory_reservations_set_updated_at before update on public.inventory_reservations
for each row execute function public.set_updated_at();

alter table public.inventory_locations enable row level security;
alter table public.inventory_levels enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.inventory_movements enable row level security;

comment on function public.reserve_inventory(uuid, bigint, text, text, text, timestamptz, text) is
  'Atomic strict-stock reservation. Concurrent requests cannot make reserved exceed on_hand.';
