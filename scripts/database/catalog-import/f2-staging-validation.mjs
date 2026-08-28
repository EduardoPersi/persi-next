import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
const env=readPrivateEnvironment(),sql=postgres(stagingDirectUrl(env.stagingPassword),{ssl:"require",prepare:false,max:1});
try{const [row]=await sql`select
  (select count(*) from supabase_migrations.schema_migrations)::int migrations,
  (select count(*) from pg_tables where schemaname='public')::int tables,
  (select count(*) from pg_tables where schemaname='public' and rowsecurity)::int rls,
  (select count(*) from pg_policies where schemaname='public')::int policies,
  (select count(*) from integration_inbox)::int inbox,
  (select count(*) from integration_inbox where status='dead_letter')::int dead_letter,
  (select count(*) from integration_inbox where status in ('pending','retry','processing'))::int pending,
  (select count(*) from catalog_search_documents)::int search_documents,
  (select count(*) from products)::int products`;
console.log(JSON.stringify(row,null,2));if(row.migrations!==13||row.rls!==row.tables||row.policies!==0||row.dead_letter!==0||row.pending!==0||row.search_documents!==row.products)process.exitCode=1;}finally{await sql.end({timeout:5});}
