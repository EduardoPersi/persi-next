-- A3.5C: minimal canonical schema for the four attributes approved after the
-- A3.5A/A3.5B audits (material, comprimento, volume, conexao). Deliberately
-- does NOT create "diameter" or "thread" — real evidence showed both are, in
-- practice, either bitola/bitola_mm captured under a different label or a
-- residual free-text bucket, never a distinct commercial concept of their
-- own (see A3.5A finding: 76 of 113 open conflicts trace back to exactly
-- this ambiguity). bitola and bitola_mm are reused as-is and are not
-- touched by this migration.
--
-- No product_attribute_values backfill happens here — that is A3.5D. These
-- four attributes start at status='draft' precisely because nothing
-- populates them yet; flipping to 'active' is a trivial follow-up once
-- backfill begins, not something this migration should claim prematurely.
--
-- comprimento/volume use data_type='measurement' (unit_dimension='length'/
-- 'volume') instead of the option/enum pattern bitola/bitola_mm already use
-- — a deliberate improvement identified in A3.5A: continuous physical
-- measurements do not belong as ad-hoc enum strings. No attribute_values are
-- seeded for them here (a measurement attribute_value needs a concrete
-- numerator/denominator/unit per real product — that is backfill, not
-- schema). The only new reference data this requires is the handful of real
-- units the extractor's own evidence actually produces for these two
-- attributes specifically: "m" for comprimento (length's regex branch only
-- ever captures bare meters — mm/cm feed bitola/bitola_mm/diameter, never
-- length) and "mL"/"L" for volume.
--
-- These three rows are copied byte-for-byte (code/symbol/name/dimension)
-- from supabase/seed.sql's own canonical unit list, which already defines
-- the project's intended full unit vocabulary (mm, cm, m, in, g, kg, mL, L,
-- W, kW, V, A, bar, psi, HP, CV) but is a LOCAL-ONLY dev seed — persi-staging
-- never runs it (confirmed read-only: units had 0 rows there before this
-- migration). Reusing the exact same codes/spelling means this migration is
-- a genuine no-op wherever seed.sql also runs (local resets), and makes
-- persi-staging consistent with the vocabulary the project already
-- committed to, instead of introducing a parallel/duplicate unit (an
-- earlier draft of this migration mistakenly used 'ml' instead of the
-- canonical 'mL' — caught during local reset validation, fixed here). No
-- unit conversion graph is established (base_unit_id/conversion_* left
-- null, matching seed.sql) — consistent with A3.5B's explicit principle of
-- never auto-converting between unit systems.

insert into public.units (code, symbol, name, dimension)
values
  ('m', 'm', 'metro', 'length'),
  ('mL', 'mL', 'mililitro', 'volume'),
  ('L', 'L', 'litro', 'volume')
on conflict (code) do nothing;

insert into public.attributes
  (code, name, data_type, cardinality, unit_dimension, is_commercial, is_technical, is_variation, is_filterable, is_searchable, is_visible, status)
values
  ('material', 'Material', 'option', 'multiple', null, true, false, false, true, false, true, 'draft'),
  ('comprimento', 'Comprimento', 'measurement', 'multiple', 'length', true, false, false, true, false, true, 'draft'),
  ('volume', 'Volume', 'measurement', 'multiple', 'volume', true, false, false, true, false, true, 'draft'),
  ('conexao', 'Conexão', 'option', 'multiple', null, true, false, false, true, false, true, 'draft')
on conflict (code) do nothing;

-- material vocabulary: every value below is confirmed present in real
-- staging evidence (extractor dry-run across all 3080 products, A3.5C
-- audit), not invented — counts observed: PVC 459, aço 584, latão 155,
-- alumínio 131, borracha 89, cobre 77, CPVC 73, porcelana 42, aço inox 40,
-- polietileno 33.
insert into public.attribute_values (attribute_id, display_value, option_code)
select a.id, v.display_value, v.option_code
from public.attributes a
join (values
  ('PVC', 'pvc'),
  ('CPVC', 'cpvc'),
  ('Porcelana', 'porcelana'),
  ('Cobre', 'cobre'),
  ('Latão', 'latao'),
  ('Aço Inox', 'aco_inox'),
  ('Aço', 'aco'),
  ('Alumínio', 'aluminio'),
  ('Polietileno', 'polietileno'),
  ('Borracha', 'borracha')
) as v(display_value, option_code) on true
where a.code = 'material'
on conflict (attribute_id, option_code) where option_code is not null do nothing;

-- conexao vocabulary: the connection type itself, never the bitola/size of
-- the connection (kept as a separate concept — see A3.5A section 5). Real
-- counts observed: roscável 382, soldável 161, compressão 22, engate rápido
-- 11, flange 7. "rosca" is intentionally absent: the extractor already
-- normalizes it to "roscável" before it ever becomes a candidate value.
insert into public.attribute_values (attribute_id, display_value, option_code)
select a.id, v.display_value, v.option_code
from public.attributes a
join (values
  ('Soldável', 'soldavel'),
  ('Roscável', 'roscavel'),
  ('Compressão', 'compressao'),
  ('Engate Rápido', 'engate_rapido'),
  ('Flange', 'flange')
) as v(display_value, option_code) on true
where a.code = 'conexao'
on conflict (attribute_id, option_code) where option_code is not null do nothing;
