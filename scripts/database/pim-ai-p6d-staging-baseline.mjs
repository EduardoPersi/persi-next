import postgres from "postgres";
import {readPrivateEnvironment,stagingDirectUrl,STAGING_PROJECT_REF} from "./catalog-import/config.mjs";
const sql=postgres(stagingDirectUrl(readPrivateEnvironment().stagingPassword),{max:1,prepare:false,ssl:"require",connect_timeout:20});
try {
 const migrations=await sql`select version,name from supabase_migrations.schema_migrations order by version`;
 const [row]=await sql`select current_database() database,current_setting('server_version') version,
 (select count(*)::int from products) products,(select count(*)::int from product_variants) variants,(select count(*)::int from prices) prices,
 (select count(*)::int from inventory_levels) inventory,(select count(*)::int from inventory_movements) movements,
 (select count(*)::int from pim_suggestions) suggestions,(select count(*)::int from pim_suggestions where status='needs_review' and superseded_at is null) needs_review,
 (select count(distinct product_id)::int from pim_suggestions where status='needs_review' and superseded_at is null) products_with_suggestions,
 (select count(*)::int from pim_product_profiles) profiles,(select count(*)::int from pim_product_profiles where workflow_status='draft') drafts,
 (select count(*)::int from pim_product_profiles where workflow_status='approved') approvals,(select count(*)::int from pim_product_profiles where workflow_status='published') publications,
 (select count(*)::int from pim_audit_log) audit,(select count(*)::int from product_media) media,
 (select count(distinct product_id)::int from product_media) products_with_media,(select count(*)::int from external_mappings) mappings,
 (select count(*)::int from products where primary_category_id is null) primary_category_null,
 (select count(distinct product_id)::int from product_categories) category_fallback,
 to_regclass('public.pim_conflicts') is not null conflicts_exists`;
 console.log(JSON.stringify({target:"persi-staging",projectRef:STAGING_PROJECT_REF,...row,migrations},null,2));
} finally {await sql.end({timeout:5});}
