import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import postgres from "postgres";
import {localDatabaseUrl} from "./local-database.mjs";
process.env.PIM_AI_ENABLED="false";
const expectedHash="34d9d5cd00d01ab595576622aaebd009b4b9179db58a837cdc9a180d8ba12bd2";
const artifact=JSON.parse(readFileSync("supabase/.temp/pim-ai/p6d-conflict-persistence/preflight-manifest.json","utf8"));
const items=artifact.items,productIds=[...new Set(items.map(item=>item.productId))];
const actualHash=createHash("sha256").update(JSON.stringify(items)).digest("hex");
assert.equal(artifact.manifestHash,expectedHash);assert.equal(actualHash,expectedHash);assert.equal(productIds.length,95);assert.equal(items.length,115);
const sql=postgres(localDatabaseUrl(),{max:1,prepare:false});
const counts=async tx=>(await tx`select (select count(*)::int from products) products,(select count(*)::int from product_variants) variants,(select count(*)::int from prices) prices,(select count(*)::int from inventory_levels) inventory,(select count(*)::int from pim_suggestions) suggestions,(select count(*)::int from pim_product_profiles) profiles,(select count(*)::int from pim_audit_log) audit,(select count(*)::int from product_media) media,(select count(*)::int from external_mappings) mappings`)[0];
const insert=async(tx,item)=>(await tx`insert into pim_conflicts(product_id,attribute_key,conflict_type,status,source_fingerprint,evidence_fingerprint,detector_version,metadata) values(${item.productId}::uuid,${item.attributeKey},${item.conflictType},'open',${item.sourceFingerprint},${item.evidenceFingerprint},${item.detectorVersion},${tx.json(item.metadata)}) on conflict(product_id,attribute_key,conflict_type,source_fingerprint,evidence_fingerprint,detector_version) do nothing returning id`).length;
let report;
try {
 await sql.begin(async tx=>{
  const before=await counts(tx);
  for(let index=0;index<productIds.length;index++)await tx`insert into products(id,name,slug) values(${productIds[index]}::uuid,${`P6D local fixture ${index+1}`},${`p6d-local-fixture-${index+1}`})`;
  const fixtureBaseline=await counts(tx);let firstInserted=0,secondInserted=0;
  for(const item of items)firstInserted+=await insert(tx,item);
  for(const item of items)secondInserted+=await insert(tx,item);
  const validation=(await tx`select count(*)::int rows,count(distinct product_id)::int products,count(*) filter(where status='open')::int open,count(*) filter(where conflict_type not in('true_source_contradiction','unresolved_ambiguity'))::int unexpected,count(*) filter(where metadata ? 'values' and metadata ? 'evidence')::int evidence from pim_conflicts where detector_version='pim-source-conflict-policy-v2'`)[0];
  const dashboard=(await tx`select count(distinct product_id)::int conflicts from pim_conflicts where status='open'`)[0];
  const detail=(await tx`select count(*)::int rows,count(*) filter(where jsonb_array_length(metadata->'evidence')>0)::int evidence from pim_conflicts where product_id=${productIds[0]}::uuid and status='open'`)[0];
  const filter=(await tx`select count(*)::int products from products p where exists(select 1 from pim_conflicts pc where pc.product_id=p.id and pc.status='open')`)[0];
  const after=await counts(tx);assert.equal(firstInserted,115);assert.equal(secondInserted,0);assert.deepEqual(after,fixtureBaseline);assert.deepEqual(validation,{rows:115,products:95,open:115,unexpected:0,evidence:115});assert.equal(dashboard.conflicts,95);assert.equal(filter.products,95);assert.ok(detail.rows>0&&detail.evidence===detail.rows);
  report={manifest:{products:95,conflicts:115,expectedHash,actualHash,match:true},localImport:{attempted:115,inserted:firstInserted,duplicates:0,unexpected:validation.unexpected},idempotency:{alreadyExistsExact:115,wouldInsert:secondInserted},panel:{dashboard:dashboard.conflicts,filter:filter.products,detail:detail.rows,evidence:detail.evidence},safety:{resolvedClassificationsExcluded:true,activeConflictsOnly:validation.open===115,operationalMutations:JSON.stringify(after)===JSON.stringify(fixtureBaseline),before,fixtureBaseline,after},transaction:"ROLLBACK_AFTER_VALIDATION",openAiCalls:0};
  throw Object.assign(new Error("P6D_VALIDATION_ROLLBACK"),{code:"P6D0"});
 });
} catch(error) {if(error?.code!=="P6D0")throw error;} finally {await sql.end({timeout:5});process.env.PIM_AI_ENABLED="false";}
console.log(JSON.stringify(report,null,2));
