import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";

if (!process.argv.includes("--staging-audit")) {
  throw new Error("Este script é read-only e exige --staging-audit explícito.");
}

const env = readPrivateEnvironment();
const sql = postgres(stagingDirectUrl(env.stagingPassword), { max: 1, prepare: false, ssl: "require" });
const causalWindowMs = 5_000;

const semanticKey = (row) => JSON.stringify([
  row.price_id,
  row.product_variant_id,
  row.price_list_id,
  row.currency,
  row.previous_list_amount_minor,
  row.new_list_amount_minor,
  row.previous_sale_amount_minor,
  row.new_sale_amount_minor,
]);

try {
  await sql.begin(async (tx) => {
    await tx`set transaction read only`;
    const rows = await tx`
      select
        history.id,
        history.price_id,
        price.product_variant_id,
        price.price_list_id,
        history.previous_list_amount_minor::text,
        history.new_list_amount_minor::text,
        history.previous_sale_amount_minor::text,
        history.new_sale_amount_minor::text,
        history.currency,
        history.source,
        history.source_event_id,
        history.changed_at
      from public.price_history history
      join public.prices price on price.id = history.price_id
      order by history.changed_at, history.id
    `;
    const groups = new Map();
    for (const row of rows) {
      const key = semanticKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const confirmed = [];
    const ambiguous = [];
    for (const groupRows of groups.values()) {
      if (groupRows.length < 2) continue;
      const triggerRows = groupRows.filter((row) => row.source_event_id === null);
      const importerRows = groupRows.filter((row) => /^product:[^:]+:.+:[^:]+$/.test(row.source_event_id ?? ""));
      const candidates = [];
      for (const triggerRow of triggerRows) {
        for (const importerRow of importerRows) {
          const distanceMs = Math.abs(new Date(triggerRow.changed_at).getTime() - new Date(importerRow.changed_at).getTime());
          if (distanceMs <= causalWindowMs) candidates.push({ triggerRow, importerRow, distanceMs });
        }
      }
      if (groupRows.length === 2 && triggerRows.length === 1 && importerRows.length === 1 && candidates.length === 1) {
        confirmed.push(candidates[0]);
      } else {
        ambiguous.push({
          rows: groupRows.length,
          triggerRows: triggerRows.length,
          importerRows: importerRows.length,
          causalCandidates: candidates.length,
          earliest: groupRows[0].changed_at,
          latest: groupRows.at(-1).changed_at,
        });
      }
    }

    const affectedVariants = new Set(confirmed.map(({ triggerRow }) => triggerRow.product_variant_id));
    const timestamps = confirmed.flatMap(({ triggerRow, importerRow }) => [triggerRow.changed_at, importerRow.changed_at]).sort();
    const [structure] = await tx`
      select
        (select count(*)::int from supabase_migrations.schema_migrations) migration_count,
        (select count(*)::int from pg_trigger where tgrelid='public.prices'::regclass and tgname='prices_capture_history' and not tgisinternal) history_trigger_count,
        (select count(*)::int from pg_proc where pronamespace='public'::regnamespace and proname='capture_price_history') history_function_count,
        (select count(*)::int from pg_tables where schemaname='public') public_tables,
        (select count(*)::int from pg_tables where schemaname='public' and rowsecurity) rls_tables,
        (select count(*)::int from pg_policies where schemaname='public') public_policies
    `;
    console.log(JSON.stringify({
      mode: "READ_ONLY",
      definition: "same price/variant/list/currency/previous-new amounts; exactly one trigger row and one importer event row; causal distance <= 5 seconds",
      totalRows: rows.length,
      variantsAffected: affectedVariants.size,
      duplicateGroupsConfirmed: confirmed.length,
      redundantRowsConfirmed: confirmed.length,
      ambiguousGroups: ambiguous.length,
      probableOrigin: confirmed.length ? "POSTGRESQL_TRIGGER_PLUS_CATALOG_IMPORTER" : "NONE_CONFIRMED",
      probablePeriod: timestamps.length ? { from: timestamps[0], to: timestamps.at(-1) } : null,
      structure,
      confirmedPairs: confirmed.map(({ triggerRow, importerRow, distanceMs }) => ({
        canonicalRowId: triggerRow.id,
        redundantRowId: importerRow.id,
        changedAt: triggerRow.changed_at,
        distanceMs,
      })),
      ambiguous,
    }, null, 2));
  });
} finally {
  await sql.end({ timeout: 5 });
}
