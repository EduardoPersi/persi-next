alter table public.prices
  add column sale_valid_from timestamptz,
  add column sale_valid_to timestamptz,
  add constraint prices_sale_period_check check (
    sale_valid_to is null or sale_valid_from is null or sale_valid_to > sale_valid_from
  ),
  add constraint prices_sale_period_requires_sale_check check (
    sale_amount_minor is not null or (sale_valid_from is null and sale_valid_to is null)
  );

comment on column public.prices.sale_valid_from is
  'Optional WooCommerce sale start instant, normalized from date_on_sale_from_gmt.';
comment on column public.prices.sale_valid_to is
  'Optional WooCommerce sale end instant, normalized from date_on_sale_to_gmt.';
