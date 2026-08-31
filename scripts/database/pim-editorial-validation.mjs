import assert from "node:assert/strict";
import postgres from "postgres";

if (!process.argv.includes("--local")) throw new Error("Este teste exige --local e nunca aceita conexão remota.");
const localUrl="postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.DATABASE_URL=localUrl;
const sql=postgres(localUrl,{max:3,prepare:false});
const {savePimEditorialDraft,transitionPimEditorial,PimConcurrencyError}=await import("../../lib/pim/workflow.ts");
const {getPimProduct,getPimQueueCounts,listPimProducts}=await import("../../lib/pim/repository.ts");
const {closeDatabaseForTests}=await import("../../lib/db/index.ts");

const suffix=crypto.randomUUID();
const productId=crypto.randomUUID(),variantId=crypto.randomUUID();
const actor="wp:pim-p2-local-validation";
const baseline={
  prices:Number((await sql`select count(*)::int count from prices`)[0].count),
  stock:Number((await sql`select count(*)::int count from inventory_levels`)[0].count),
  movements:Number((await sql`select count(*)::int count from inventory_movements`)[0].count),
  mappings:Number((await sql`select count(*)::int count from external_mappings`)[0].count),
};
const content=(name)=>({productId,version:BigInt(0),commercialName:name,shortDescription:'25mm x 1/2"',description:'16mm x 1/2" | 32mm x 3/4" | 32 x 25mm',bulletPoints:['20mm','3/4"'],application:'127V e 220V',specifications:'20A e 500W',seoTitle:name,metaDescription:'Medidas preservadas',searchTerms:['25mm x 1/2"'],imageAltText:'Produto 500W'});

try{
  await sql`drop trigger if exists pim_atomic_failure on pim_audit_log`;
  await sql`insert into products(id,name,slug) values(${productId},${`SOURCE ${suffix}`},${`pim-p2-${suffix}`})`;
  await sql`insert into product_variants(id,product_id,sku,gtin) values(${variantId},${productId},${`P2-${suffix}`},'7891234567890')`;

  const created=await savePimEditorialDraft(content("DRAFT V1"),actor);assert.equal(created.version,BigInt(1));
  const detail=await getPimProduct(productId);assert.equal(detail?.draft.commercialName,"DRAFT V1");assert.equal(detail?.version,"1");
  const listing=await listPimProducts({query:`P2-${suffix}`});assert.equal(listing.total,1);assert.equal(listing.items[0]?.status,"draft");
  const queues=await getPimQueueCounts();assert.ok(queues.draft>=1);
  let profile=(await sql`select * from pim_product_profiles where product_id=${productId}`)[0];assert.equal(profile.workflow_status,"draft");assert.equal(profile.version,"1");
  const updated=await savePimEditorialDraft({...content("DRAFT V1 UPDATED"),version:BigInt(1)},actor);assert.equal(updated.version,BigInt(2));
  await transitionPimEditorial({productId,version:BigInt(2),action:"SUBMIT_REVIEW"},actor);
  await assert.rejects(()=>transitionPimEditorial({productId,version:BigInt(3),action:"SUBMIT_REVIEW"},actor),/inválida/);
  await transitionPimEditorial({productId,version:BigInt(3),action:"APPROVE"},actor);
  profile=(await sql`select * from pim_product_profiles where product_id=${productId}`)[0];assert.equal(profile.approved_content.commercialName,"DRAFT V1 UPDATED");

  await transitionPimEditorial({productId,version:BigInt(4),action:"REOPEN"},actor);
  await savePimEditorialDraft({...content("DRAFT V2"),version:BigInt(5)},actor);
  profile=(await sql`select * from pim_product_profiles where product_id=${productId}`)[0];assert.equal(profile.approved_content.commercialName,"DRAFT V1 UPDATED");assert.equal(profile.commercial_name,"DRAFT V2");

  const sharedVersion=BigInt(6);
  await savePimEditorialDraft({...content("SESSION B"),version:sharedVersion},actor);
  await assert.rejects(()=>savePimEditorialDraft({...content("SESSION A STALE"),version:sharedVersion},actor),(error)=>error instanceof PimConcurrencyError&&error.code==="PIM_STALE_VERSION");
  await transitionPimEditorial({productId,version:BigInt(7),action:"SUBMIT_REVIEW"},actor);
  await transitionPimEditorial({productId,version:BigInt(8),action:"REJECT",reason:"fixture"},actor);
  await transitionPimEditorial({productId,version:BigInt(9),action:"REOPEN"},actor);
  await transitionPimEditorial({productId,version:BigInt(10),action:"DISCARD_DRAFT"},actor);
  profile=(await sql`select * from pim_product_profiles where product_id=${productId}`)[0];assert.equal(profile.workflow_status,"approved");assert.equal(profile.commercial_name,"DRAFT V1 UPDATED");

  await sql`create function pg_temp.reject_atomic_audit() returns trigger language plpgsql as $$begin if new.actor_reference='wp:atomic-fail' then raise exception 'forced audit failure'; end if; return new; end$$`;
  await sql`create trigger pim_atomic_failure before insert on pim_audit_log for each row execute function pg_temp.reject_atomic_audit()`;
  const versionBefore=profile.version;
  await assert.rejects(()=>transitionPimEditorial({productId,version:BigInt(versionBefore),action:"REOPEN"},"wp:atomic-fail"),(error)=>error?.cause?.message==="forced audit failure");
  await sql`drop trigger pim_atomic_failure on pim_audit_log`;
  profile=(await sql`select * from pim_product_profiles where product_id=${productId}`)[0];assert.equal(profile.version,versionBefore);assert.equal(profile.workflow_status,"approved");

  assert.deepEqual(profile.bullet_points,['20mm','3/4"']);assert.equal(profile.short_description,'25mm x 1/2"');assert.equal(profile.description,'16mm x 1/2" | 32mm x 3/4" | 32 x 25mm');
  const source=(await sql`select p.name,v.sku,v.gtin from products p join product_variants v on v.product_id=p.id where p.id=${productId}`)[0];assert.equal(source.name,`SOURCE ${suffix}`);assert.equal(source.sku,`P2-${suffix}`);assert.equal(source.gtin,"7891234567890");
  const operations=(await sql`select operation from pim_audit_log where product_id=${productId} order by created_at`).map(row=>row.operation);for(const operation of ["CREATE_DRAFT","UPDATE_DRAFT","SUBMIT_REVIEW","APPROVE","REOPEN","REJECT","DISCARD_DRAFT"])assert.ok(operations.includes(operation),operation);
  assert.deepEqual({prices:Number((await sql`select count(*)::int count from prices`)[0].count),stock:Number((await sql`select count(*)::int count from inventory_levels`)[0].count),movements:Number((await sql`select count(*)::int count from inventory_movements`)[0].count),mappings:Number((await sql`select count(*)::int count from external_mappings`)[0].count)},baseline);
  console.log(JSON.stringify({createDraft:true,updateDraft:true,submitReview:true,approve:true,reject:true,reopen:true,discard:true,approvedImmutability:true,staleWriteRejected:true,auditAtomicity:true,compoundMeasureRoundtrip:true,sourceImmutable:true,adminList:true,adminProductDetail:true,reviewQueue:true,inventoryMovementsCreated:0,auditEvents:operations.length}));
}finally{
  await sql`drop trigger if exists pim_atomic_failure on pim_audit_log`;
  await sql`delete from pim_audit_log where product_id=${productId}`;await sql`delete from pim_product_profiles where product_id=${productId}`;await sql`delete from product_variants where id=${variantId}`;await sql`delete from products where id=${productId}`;
  await closeDatabaseForTests();await sql.end({timeout:5});
}
