import crypto from "node:crypto";
import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl, STAGING_PROJECT_REF } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { CatalogImporter } from "./import.mjs";
import { resolveGtin } from "./normalize.mjs";
import { claimSignals, enqueueSignal, finishSignal } from "./incremental-core.mjs";

if (!process.argv.includes("--staging") || !process.argv.includes("--approved-f2-sync")) throw new Error("Exige --staging --approved-f2-sync.");
if (STAGING_PROJECT_REF !== "vtrujmhhkmvjzfklzxip") throw new Error("TARGET_NOT_APPROVED");
const env=readPrivateEnvironment(), extractor=new WooReadOnlyExtractor(env), sql=postgres(stagingDirectUrl(env.stagingPassword),{max:2,prepare:false,ssl:"require",connect_timeout:15});
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:0;
const modified=(product)=>product.date_modified_gmt?`${product.date_modified_gmt}Z`:null;

try {
  const [target]=await sql`select current_database() database,(select count(*) from supabase_migrations.schema_migrations)::int migrations`;
  if(target.database!=="postgres"||target.migrations<8)throw new Error("F2_MIGRATION_REQUIRED");
  const extractionStart=performance.now(), [products,categories,brands]=await Promise.all([extractor.all("products"),extractor.all("products/categories"),extractor.all("products/brands")]);
  const duplicateGtins=new Set(),seenGtins=new Set();for(const product of products){const gtin=resolveGtin(product).value;if(gtin&&(seenGtins.has(gtin)?duplicateGtins.add(gtin):seenGtins.add(gtin)));}
  const requestedIds=(process.argv.find((x)=>x.startsWith("--product-ids="))?.slice(14)??"").split(",").filter(Boolean);
  const mappingRows=await sql`select external_id,source_changed_at from public.external_mappings where system='woocommerce' and entity_type='product'`;
  const mappedVersions=new Map(mappingRows.map((x)=>[x.external_id,x.source_changed_at?new Date(x.source_changed_at).valueOf():null]));
  const stale=products.filter((product)=>{const source=modified(product),target=mappedVersions.get(String(product.id));return !target||(source&&new Date(source).valueOf()>target);});
  const changed=requestedIds.length?products.filter((x)=>requestedIds.includes(String(x.id))):stale.slice(0,100);
  for(const product of changed)await enqueueSignal(sql,{eventType:"product.reconcile",externalEventId:`reconcile:product:${product.id}:${modified(product)??"unknown"}`,entityType:"product",externalEntityId:product.id,sourceChangedAt:modified(product)});
  await sql`insert into public.integration_checkpoints(source,stream,last_started_at) values('woocommerce','catalog-products',now()) on conflict(source,stream) do update set last_started_at=now(),last_error_code=null`;
  const importer=new CatalogImporter(sql,{categories,brands,profiling:true,duplicateGtins}),workerId=`f2-${crypto.randomUUID()}`,durations=[],convergence=[],sourceAge=[],results={insert:0,update:0,noop:0,conflict:0,failed:0,retries:extractor.retries};
  while(true){const rows=await claimSignals(sql,workerId,25);if(!rows.length)break;for(const row of rows){const started=performance.now();try{if(row.entity_type!=="product")throw Object.assign(new Error("ENTITY_NOT_SUPPORTED"),{status:422});const response=await extractor.get(`products/${row.external_entity_id}`);const product=response.data;if(!product||typeof product.id!=="number")throw Object.assign(new Error("ARCHIVE_POLICY_UNPROVEN"),{status:422});const before={...importer.metrics};const variations=product.type==="variable"?await extractor.variations(product.id):[];const result=await importer.importProduct(product,variations);const writes=(importer.metrics.insert-before.insert)+(importer.metrics.update-before.update)+(importer.metrics.delete-before.delete);const outcome=result.status==="conflict"?"conflict":result.created?"insert":writes?"update":"noop";const durationMs=Math.round(performance.now()-started);results[outcome]+=1;durations.push(durationMs);convergence.push(Math.max(0,Date.now()-new Date(row.received_at).valueOf()));if(row.source_changed_at)sourceAge.push(Math.max(0,Date.now()-new Date(row.source_changed_at).valueOf()));await finishSignal(sql,row,{ok:true,result:outcome,durationMs});}catch(error){results.failed+=1;await finishSignal(sql,row,{ok:false,error,code:error.code??error.message??"SYNC_FAILED"});}}}
  const latest=products.map(modified).filter(Boolean).sort().at(-1)??null;
  await sql`insert into public.integration_checkpoints(source,stream,cursor_changed_at,cursor_value,last_completed_at) values('woocommerce','catalog-products',${latest},${String(products.at(-1)?.id??"")},now()) on conflict(source,stream) do update set cursor_changed_at=excluded.cursor_changed_at,cursor_value=excluded.cursor_value,last_completed_at=now(),last_error_code=null`;
  console.log(JSON.stringify({target:`persi-staging:${STAGING_PROJECT_REF}`,sourceProducts:products.length,staleDetected:stale.length,changedSignals:changed.length,results,requests:extractor.requests,extractionMs:Math.round(performance.now()-extractionStart),sync:{count:durations.length,p50Ms:percentile(durations,.5),p95Ms:percentile(durations,.95),maxMs:Math.max(0,...durations)},convergence:{definition:"inbox received_at to processed",count:convergence.length,p50Ms:percentile(convergence,.5),p95Ms:percentile(convergence,.95),maxMs:Math.max(0,...convergence)},sourceAge:{count:sourceAge.length,p50Ms:percentile(sourceAge,.5),p95Ms:percentile(sourceAge,.95),maxMs:Math.max(0,...sourceAge)}},null,2));
} finally { await sql.end({timeout:5}); }
