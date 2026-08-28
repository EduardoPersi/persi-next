-- The PostgreSQL trigger remains the exclusive automatic price_history writer.
-- Remove only legacy importer rows that have one exact trigger twin from the
-- former double-writer window. Exact timestamp and full transition equality
-- make the cleanup deterministic; ambiguous or repeated groups are preserved.
with confirmed_double_writer_groups as (
  select
    price_id,
    previous_list_amount_minor,
    new_list_amount_minor,
    previous_sale_amount_minor,
    new_sale_amount_minor,
    currency,
    source,
    changed_at
  from public.price_history
  group by
    price_id,
    previous_list_amount_minor,
    new_list_amount_minor,
    previous_sale_amount_minor,
    new_sale_amount_minor,
    currency,
    source,
    changed_at
  having count(*) = 2
    and count(*) filter (where source_event_id is null) = 1
    and count(*) filter (where source_event_id like 'product:%') = 1
), redundant_importer_rows as (
  select history.id
  from public.price_history history
  join confirmed_double_writer_groups duplicate
    on duplicate.price_id = history.price_id
   and duplicate.previous_list_amount_minor is not distinct from history.previous_list_amount_minor
   and duplicate.new_list_amount_minor = history.new_list_amount_minor
   and duplicate.previous_sale_amount_minor is not distinct from history.previous_sale_amount_minor
   and duplicate.new_sale_amount_minor is not distinct from history.new_sale_amount_minor
   and duplicate.currency = history.currency
   and duplicate.source = history.source
   and duplicate.changed_at = history.changed_at
  where history.source_event_id like 'product:%'
)
delete from public.price_history history
using redundant_importer_rows redundant
where history.id = redundant.id;
