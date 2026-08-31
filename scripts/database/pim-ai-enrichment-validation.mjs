import assert from "node:assert/strict";
import postgres from "postgres";
if(!process.argv.includes("--local"))throw new Error("Este teste exige --local.");
const url="postgresql://postgres:postgres@127.0.0.1:54322/postgres";process.env.DATABASE_URL=url;
const sql=postgres(url,{max:3,prepare:false});
const {generateDeterministicSuggestions}=await import("../../lib/pim/enrichment-service.ts");
const {decidePimSuggestion}=await import("../../lib/pim/workflow.ts");
const {closeDatabaseForTests}=await import("../../lib/db/index.ts");
const productId=crypto.randomUUID(),variantId=crypto.randomUUID(),suffix=crypto.randomUUID();
const before={prices:Number((await sql`select count(*)::int count from prices`)[0].count),stock:Number((await sql`select count(*)::int count from inventory_levels`)[0].count),movements:Number((await sql`select count(*)::int count from inventory_movements`)[0].count)};
try{
 await sql`insert into products(id,name,slug,description) values(${productId},'Luva Redução Soldável Rosca 25mm x 1/2 Tigre',${`p3-${suffix}`},'PVC marrom')`;
 await sql`insert into product_variants(id,product_id,sku,gtin) values(${variantId},${productId},${`P3-${suffix}`},'7891234567890')`;
 const first=await generateDeterministicSuggestions(productId),second=await generateDeterministicSuggestions(productId);assert.equal(first.fingerprint,second.fingerprint);
 const activeBefore=Number((await sql`select count(*)::int count from pim_suggestions where product_id=${productId} and superseded_at is null`)[0].count);assert.equal(activeBefore,first.candidates.length);
 await sql`update products set name='Luva Redução Soldável Rosca 32mm x 3/4 Tigre' where id=${productId}`;
 const third=await generateDeterministicSuggestions(productId);assert.notEqual(third.fingerprint,first.fingerprint);
 assert.ok(Number((await sql`select count(*)::int count from pim_suggestions where product_id=${productId} and superseded_at is not null`)[0].count)>0);
 const fingerprint="a".repeat(64);
 const [accepted]=await sql`insert into pim_suggestions(product_id,field_name,suggested_value,source,confidence,status,suggestion_type,payload,provider,model_version,prompt_version,source_fingerprint,extraction_method,evidence_references) values(${productId},'commercial_name','Luva editorial Persi','ai',.8,'needs_review','field','{}','mock','mock-v1','pim-enrichment-v1',${fingerprint},'ai_inference','[]') returning id`;
 await decidePimSuggestion({suggestionId:accepted.id,decision:"approved",actorReference:"wp:p3-local"});
 const [profile]=await sql`select workflow_status::text status,commercial_name,approved_content from pim_product_profiles where product_id=${productId}`;assert.equal(profile.status,"draft");assert.equal(profile.commercial_name,"Luva editorial Persi");assert.equal(profile.approved_content,null);
 const [rejected]=await sql`insert into pim_suggestions(product_id,field_name,suggested_value,source,status,suggestion_type,payload,provider,model_version,prompt_version,source_fingerprint,extraction_method,evidence_references) values(${productId},'description','Texto rejeitado','ai','needs_review','field','{}','mock','mock-v1','pim-enrichment-v1',${"b".repeat(64)},'ai_inference','[]') returning id`;
 await decidePimSuggestion({suggestionId:rejected.id,decision:"rejected",actorReference:"wp:p3-local"});assert.equal((await sql`select status::text from pim_suggestions where id=${rejected.id}`)[0].status,"rejected");
 const after={prices:Number((await sql`select count(*)::int count from prices`)[0].count),stock:Number((await sql`select count(*)::int count from inventory_levels`)[0].count),movements:Number((await sql`select count(*)::int count from inventory_movements`)[0].count)};assert.deepEqual(after,before);
 console.log(JSON.stringify({idempotency:true,staleSuperseded:true,acceptSuggestion:true,rejectSuggestion:true,suggestionToDraft:true,autoApproval:false,publication:false,aiCalls:0,inventoryMovementsCreated:0}));
}finally{await sql`delete from pim_audit_log where product_id=${productId}`;await sql`delete from pim_suggestions where product_id=${productId}`;await sql`delete from pim_product_profiles where product_id=${productId}`;await sql`delete from product_variants where id=${variantId}`;await sql`delete from products where id=${productId}`;await closeDatabaseForTests();await sql.end({timeout:5});}
