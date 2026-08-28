import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";

if (!process.argv.includes("--staging") || !process.argv.includes("--read-only")) {
  throw new Error("Exige --staging --read-only.");
}

const env = readPrivateEnvironment();
const woo = new WooReadOnlyExtractor(env);
const sql = postgres(stagingDirectUrl(env.stagingPassword), { ssl: "require", prepare: false, max: 1 });

try {
  const products = await woo.all("products");
  const rows = await sql`
    select mapping.external_id::int id, mapping.source_changed_at::text,
      coalesce(array_agg(category_mapping.external_id::int order by category_mapping.external_id)
        filter (where category_mapping.external_id is not null), '{}') category_ids
    from public.products product
    join public.external_mappings mapping on mapping.internal_id=product.id
      and mapping.system='woocommerce' and mapping.entity_type='product'
    left join public.product_categories membership on membership.product_id=product.id
    left join public.external_mappings category_mapping on category_mapping.internal_id=membership.category_id
      and category_mapping.system='woocommerce' and category_mapping.entity_type='category'
    group by mapping.external_id,mapping.source_changed_at
  `;
  const target = new Map(rows.map((row) => [row.id, row]));
  const cases = [];
  for (const product of products) {
    const row = target.get(product.id);
    const expected = (product.categories ?? []).map((item) => item.id).sort((a, b) => a - b);
    const actual = [...(row?.category_ids ?? [])].map(Number).sort((a, b) => a - b);
    if (JSON.stringify(expected) === JSON.stringify(actual)) continue;
    const wooChangedAt = product.date_modified_gmt ? new Date(`${product.date_modified_gmt}Z`).toISOString() : null;
    const sourceChangedAt = row?.source_changed_at ? new Date(row.source_changed_at).toISOString() : null;
    const classification = wooChangedAt && (!sourceChangedAt || new Date(wooChangedAt) > new Date(sourceChangedAt))
      ? "UNSYNCED_SOURCE_CHANGE"
      : "UNKNOWN";
    cases.push({ wooExternalId: product.id, expected, actual, wooChangedAt, sourceChangedAt, classification });
  }
  console.log(JSON.stringify({
    productsCompared: products.length,
    cases,
    counts: {
      UNSYNCED_SOURCE_CHANGE: cases.filter((item) => item.classification === "UNSYNCED_SOURCE_CHANGE").length,
      UNKNOWN: cases.filter((item) => item.classification === "UNKNOWN").length,
    },
    reconciliationIds: cases.filter((item) => item.classification === "UNSYNCED_SOURCE_CHANGE").map((item) => item.wooExternalId),
    woo: { requests: woo.requests, retries: woo.retries },
  }, null, 2));
  if (cases.some((item) => item.classification !== "UNSYNCED_SOURCE_CHANGE")) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
