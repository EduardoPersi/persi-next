import fs from "node:fs";
import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl, STAGING_PROJECT_REF } from "./config.mjs";
if(!process.argv.includes("--staging")||!process.argv.includes("--approved-migration"))throw new Error("Exige --staging --approved-migration.");
const version="20260823110600",path=`supabase/migrations/${version}_sale_periods.sql`,env=readPrivateEnvironment(),sql=postgres(stagingDirectUrl(env.stagingPassword),{max:1,prepare:false,ssl:"require",connect_timeout:15});
try{const [identity]=await sql`select current_database() database`;if(identity.database!=="postgres")throw new Error("Banco inesperado");const [exists]=await sql`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='prices' and column_name='sale_valid_from') applied`;if(!exists.applied){await sql.begin(async(tx)=>{await tx.unsafe(fs.readFileSync(path,"utf8"));await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},'sale_periods',${[fs.readFileSync(path,"utf8")]}) on conflict(version) do nothing`;});}
  const [verified]=await sql`select count(*)::int columns from information_schema.columns where table_schema='public' and table_name='prices' and column_name in ('sale_valid_from','sale_valid_to')`;console.log(JSON.stringify({target:`persi-staging:${STAGING_PROJECT_REF}`,migration:version,alreadyApplied:exists.applied,columns:verified.columns}));if(verified.columns!==2)process.exitCode=1;
}finally{await sql.end({timeout:5});}
