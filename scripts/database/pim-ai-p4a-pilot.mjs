import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import postgres from "postgres";
import {preparePimAiDryRun} from "../../lib/pim/ai-dry-run.ts";
import {GPT_5_4_MINI_PRICING} from "../../lib/pim/ai-pricing.ts";
import {PimAttributeExtractor} from "../../lib/pim/extractor.ts";
import {auditSemanticUnit} from "../../lib/pim/semantic-validation.ts";
import {buildSafeAiProductContext} from "../../lib/pim/safe-ai-context.ts";
import {auditForbiddenSafeContext,buildPilotSourceSnapshot,createStableFingerprint,safeContextFingerprint,scanPromptInjection,scanSafeContextDlp} from "../../lib/pim/pilot-preparation.ts";

const PROJECT_REF="vtrujmhhkmvjzfklzxip",mode=process.argv[2];
if(mode!=="--staging-read-only"||process.argv.length!==3)throw new Error("Exige exatamente --staging-read-only.");
if(process.env.PIM_AI_ENABLED==="true")throw new Error("PIM_AI_ENABLED deve permanecer false.");

function envValue(name){for(const path of [".env.staging.local",".env.local"]){if(!existsSync(path))continue;const line=(awaitableRead(path)).find(item=>item.startsWith(`${name}=`));if(line)return line.slice(name.length+1).trim().replace(/^(['"])(.*)\1$/,"$2");}throw new Error(`${name} não configurada.`);}
function awaitableRead(path){return requireText(path).split(/\r?\n/);}
function requireText(path){return globalThis.__p4aFiles.get(path);}
globalThis.__p4aFiles=new Map();
for(const path of [".env.staging.local",".env.local","supabase/.temp/pooler-url"])if(existsSync(path))globalThis.__p4aFiles.set(path,await readFile(path,"utf8"));

const password=envValue("PERSI_STAGING_DB_PASSWORD"),poolerTemplate=globalThis.__p4aFiles.get("supabase/.temp/pooler-url")?.trim();
assert.ok(poolerTemplate?.includes(PROJECT_REF),"Pooler não pertence ao persi-staging.");
const url=new URL(poolerTemplate);url.password=password;
const sql=postgres(url.toString(),{max:1,prepare:false,ssl:"require",connect_timeout:20,idle_timeout:5});

const compact=(value)=>typeof value==="string"?value.replace(/\s+/g," ").trim():value;
const toInput=(row)=>({productId:row.id,name:compact(row.name),description:compact(row.description)||compact(row.short_description)||null,sku:row.sku||"",gtin:row.gtin||null,brand:compact(row.brand)||null,category:compact(row.category)||null,attributes:Array.isArray(row.attributes)?row.attributes.map(item=>({name:compact(item.name),value:compact(item.value)})):[]});
const config={enabled:false,provider:"openai",model:"gpt-5.4-mini",promptVersion:"pim-enrichment-v2",apiKey:null,maxOutputTokens:1200,timeoutMs:20000,rateLimitPerMinute:2,maxEstimatedCostUsdMicros:20000n,pricing:GPT_5_4_MINI_PRICING,includeGtin:false};
const extractor=new PimAttributeExtractor();

function inspect(row){
 const input=toInput(row),source=buildPilotSourceSnapshot(input),safeContext=buildSafeAiProductContext(input,{includeGtin:false}),candidates=extractor.extract(source);
 const dlp=scanSafeContextDlp(safeContext),promptInjection=scanPromptInjection(input),forbidden=auditForbiddenSafeContext(safeContext),semanticMismatches=candidates.flatMap(item=>{const mismatch=auditSemanticUnit(item.attribute,item.value);return mismatch?[mismatch]:[];});
 const conflicts=candidates.filter(item=>item.status==="CONFLICT"),dryRun=preparePimAiDryRun(input,config),compoundValues=candidates.filter(item=>/\sx\s/i.test(item.value)).map(item=>item.value),technicalUnits=candidates.filter(item=>item.unit).map(item=>({attribute:item.attribute,value:item.value,unit:item.unit}));
 return{row,input,source,safeContext,candidates,dlp,promptInjection,forbidden,semanticMismatches,conflicts,dryRun,compoundValues,technicalUnits,eligible:dlp.status==="PASS"&&promptInjection.status==="PASS"&&!forbidden.length&&!semanticMismatches.length&&!conflicts.length&&dryRun.requestSent===false&&dryRun.budget.allowed};
}

function pick(pool,predicate,score=()=>0){return pool.filter(item=>item.eligible&&predicate(item)).sort((left,right)=>score(right)-score(left)||left.input.name.localeCompare(right.input.name,"pt-BR"))[0];}

let stagingReads=0,beforeCounts,afterCounts,inspected=[];
try{
 await sql.begin(async tx=>{
  await tx`set transaction read only`;
  const [identity]=await tx`select current_database() database,current_user "user",current_setting('transaction_read_only') "readOnly"`;stagingReads++;
  assert.equal(identity.database,"postgres");assert.equal(identity.readOnly,"on");assert.ok(poolerTemplate.includes(PROJECT_REF),"Endpoint não confirma o projeto persi-staging.");
  [beforeCounts]=await tx`select (select count(*)::int from products) products,(select count(*)::int from pim_suggestions) suggestions,(select count(*)::int from pim_product_profiles) profiles`;stagingReads++;
  const rows=await tx`select p.id,p.name,p.short_description,p.description,b.name brand,coalesce(c.name,pcat.name) category,v.sku,v.gtin,
   coalesce(a.items,'[]'::jsonb) attributes
   from products p
   join lateral(select x.sku,x.gtin from product_variants x where x.product_id=p.id order by x.created_at,x.id limit 1)v on true
   left join brands b on b.id=p.brand_id left join categories c on c.id=p.primary_category_id
   left join lateral(select c2.name from product_categories pc join categories c2 on c2.id=pc.category_id where pc.product_id=p.id order by c2.name,c2.id limit 1)pcat on true
   left join lateral(select jsonb_agg(jsonb_build_object('name',z.name,'value',z.display_value) order by z.name,z.display_value) items from(
    select distinct at.name,av.display_value from product_attribute_values pav join attributes at on at.id=pav.attribute_id join attribute_values av on av.id=pav.attribute_value_id where pav.product_id=p.id
   )z)a on true where p.status<>'archived' order by p.id`;stagingReads++;
  inspected=rows.map(inspect);
  [afterCounts]=await tx`select (select count(*)::int from products) products,(select count(*)::int from pim_suggestions) suggestions,(select count(*)::int from pim_product_profiles) profiles`;stagingReads++;
 });
}finally{await sql.end({timeout:5});}

assert.deepEqual(afterCounts,beforeCounts,"Contadores mudaram durante a transação read-only.");
const selected=[],remaining=()=>inspected.filter(item=>!selected.includes(item));
const profileA=pick(remaining(),item=>item.compoundValues.some(value=>/(?:mm|cm|m)\s*x\s*(?:\d+\s+)?\d+\/\d+\"/i.test(value))&&/(?:hidr[aá]ul|irriga|adaptador|conex|joelho|luva|registro|tubo)/i.test(`${item.input.name} ${item.input.category??""}`),item=>item.compoundValues.length*100+item.input.attributes.length);assert.ok(profileA,"Perfil A hidráulico mm x polegada não encontrado");selected.push(profileA);
const profileB=pick(remaining(),item=>new Set(item.candidates.map(candidate=>candidate.attribute).filter(code=>["voltage","current","power","color_temperature"].includes(code))).size>=2&&!item.candidates.some(candidate=>candidate.attribute==="current"&&Number.parseFloat(candidate.value.replace(",","."))>1000),item=>item.input.attributes.length*10+item.candidates.length);assert.ok(profileB,"Perfil B não encontrado");selected.push(profileB);
const profileC=pick(remaining(),item=>Boolean(item.input.brand&&item.input.category&&item.input.description&&item.input.description.length>=20&&item.input.name.length>=12),item=>500-Math.abs((item.input.description?.length??0)-250)-item.candidates.length*5);if(!profileC)console.log(JSON.stringify({diagnostic:{inspected:inspected.length,eligible:inspected.filter(item=>item.eligible).length,eligibleBrand:inspected.filter(item=>item.eligible&&item.input.brand).length,eligibleCategory:inspected.filter(item=>item.eligible&&item.input.category).length,eligibleDescription:inspected.filter(item=>item.eligible&&item.input.description).length,dlpFailures:inspected.filter(item=>item.dlp.status!=="PASS").length,promptReviews:inspected.filter(item=>item.promptInjection.status!=="PASS").length,conflicts:inspected.filter(item=>item.conflicts.length).length,semanticFailures:inspected.filter(item=>item.semanticMismatches.length).length}}));assert.ok(profileC,"Perfil C não encontrado");selected.push(profileC);
const profileD=pick(remaining(),item=>Boolean(item.input.description&&item.input.description.length>=150),item=>(item.input.description?.length??0)+item.input.attributes.length*300+item.candidates.length*50);assert.ok(profileD,"Perfil D não encontrado");selected.push(profileD);
const profileE=pick(remaining(),item=>Boolean(item.input.brand&&item.input.category)&&(item.input.description?.length??0)<100&&item.input.attributes.length<=1,item=>100-(item.input.description?.length??0)+item.input.name.length);assert.ok(profileE,"Perfil E não encontrado");selected.push(profileE);

const profiles=["A_HYDRAULIC_COMPOUND","B_ELECTRICAL","C_SIMPLE","D_RICH_DATA","E_INCOMPLETE"];
const products=selected.map((item,index)=>({
 pilotSlot:index+1,profile:profiles[index],localProductReference:item.input.productId,sourceFingerprint:createStableFingerprint(item.source),safeContextFingerprint:safeContextFingerprint(item.safeContext),
 source:{title:item.input.name,description:item.input.description,brand:item.input.brand,category:item.input.category,attributes:item.input.attributes,skuPresent:Boolean(item.input.sku),gtinPresent:Boolean(item.input.gtin)},safeAiContext:item.safeContext,
 excludedFields:{sku:"EXCLUDED",gtin:"EXCLUDED",dbIds:"EXCLUDED",erpIds:"EXCLUDED",stock:"EXCLUDED",price:"EXCLUDED",cost:"EXCLUDED",margin:"EXCLUDED",other:["customers","orders","secrets","cookies","sessions"]},
 dlp:item.dlp,promptInjectionScan:item.promptInjection,deterministicAttributes:item.candidates,conflicts:item.conflicts,semanticMismatches:item.semanticMismatches,compoundValues:item.compoundValues,technicalUnits:item.technicalUnits,
 gates:{safeContext:item.forbidden.length===0?"PASS":"FAIL",dlp:item.dlp.status,promptInjectionScan:item.promptInjection.status,deterministicExtraction:"PASS",normalization:"PASS",semanticValidation:item.semanticMismatches.length?"FAIL":"PASS",conflictFree:item.conflicts.length?"NO":"YES",compoundPreservation:index===0&&item.compoundValues.length?"PASS":"N/A",requestBuild:"PASS",requestSent:"NO",pilotEligible:item.eligible?"YES":"NO"},
 request:{built:true,sent:false,model:item.dryRun.model,promptVersion:item.dryRun.promptVersion,estimatedInputTokens:item.dryRun.scope.estimatedInputTokens,maxOutputTokens:item.dryRun.scope.maxOutputTokens,estimatedCostUsdMicros:item.dryRun.budget.estimatedCostUsdMicros?.toString()??null}
}));
assert.equal(products.length,5);assert.ok(products.every(item=>item.gates.pilotEligible==="YES"));
const estimatedTotalInputTokens=products.reduce((sum,item)=>sum+item.request.estimatedInputTokens,0),estimatedTotalCostUsdMicros=products.reduce((sum,item)=>sum+BigInt(item.request.estimatedCostUsdMicros),0n);
const manifest={phase:"P.4-A",target:{name:"persi-staging",projectRef:PROJECT_REF,readOnly:true},createdAt:new Date().toISOString(),openAi:{requestAttempts:0,realCalls:0,realCostUsdMicros:"0"},limitsProposed:{maxRealProducts:5,maxRequests:5,maxRequestsPerProduct:1,retries:0,maxOutputTokensPerProduct:1200},budget:{estimatedTotalInputTokens,estimatedTotalCostUsdMicros:estimatedTotalCostUsdMicros.toString(),recommendedHardBudgetUsdMicros:"50000"},stalenessProtection:{required:true,action:"reload-and-compare-source-fingerprint",onMismatch:"STALE_BLOCK"},database:{reads:stagingReads,writes:0,beforeCounts,afterCounts},products};
const directory=resolve("supabase/.temp/pim-ai/p4a");await mkdir(directory,{recursive:true});await writeFile(resolve(directory,"pilot-manifest.json"),`${JSON.stringify(manifest,null,2)}\n`,{encoding:"utf8",flag:"w"});
console.log(JSON.stringify({phase:manifest.phase,target:manifest.target,realProductsInspected:inspected.length,realProductsSelected:products.length,pilotEligible:products.filter(item=>item.gates.pilotEligible==="YES").length,profiles:products.map(item=>({slot:item.pilotSlot,profile:item.profile,title:item.source.title,eligible:item.gates.pilotEligible,inputTokens:item.request.estimatedInputTokens,costUsdMicros:item.request.estimatedCostUsdMicros})),estimatedTotalInputTokens,estimatedTotalCostUsdMicros:estimatedTotalCostUsdMicros.toString(),recommendedHardBudgetUsdMicros:manifest.budget.recommendedHardBudgetUsdMicros,stagingReads,writes:0,requestAttempts:0,realCalls:0,manifest:"supabase/.temp/pim-ai/p4a/pilot-manifest.json"},null,2));
