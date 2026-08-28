import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { convergenceMetrics, deterministicEventId, retryDelayMs, shouldProcessSourceVersion } from "../lib/catalog/incrementalSync.ts";
import { catalogSearchScore, catalogSearchTokens, expandCatalogSearchTerms, normalizeCatalogSearch } from "../lib/catalog/search.ts";
import { planSetSync } from "../scripts/database/catalog-import/sync.mjs";

test("evento determinístico deduplica e evento fora de ordem não retrocede",()=>{
  const input={source:"woocommerce",entityType:"product",externalEntityId:"123",sourceChangedAt:"2026-08-24T12:00:00Z"};
  assert.equal(deterministicEventId(input),deterministicEventId(input));
  assert.equal(shouldProcessSourceVersion("2026-08-24T12:00:00Z","2026-08-24T11:59:59Z"),false);
  assert.equal(shouldProcessSourceVersion("2026-08-24T12:00:00Z","2026-08-24T12:00:01Z"),true);
});
test("retry usa exponential backoff limitado com jitter",()=>{
  assert.equal(retryDelayMs(1,0),500);assert.equal(retryDelayMs(2,0),1000);
  assert.ok(retryDelayMs(20,1)<=60250);
});
test("convergência calcula p50 p95 e máximo",()=>assert.deepEqual(convergenceMetrics([10,20,30,40,50]),{count:5,p50Ms:30,p95Ms:50,maxMs:50}));
test("sync diferencial cobre create/update/no-op/archive e relações",()=>{
  assert.deepEqual(planSetSync([],['create']).add,['create']);
  assert.deepEqual(planSetSync(['same'],['same']).keep,['same']);
  assert.deepEqual(planSetSync(['old'],['new']),{add:['new'],remove:['old'],keep:[]});
  assert.deepEqual(planSetSync(['active'],['archived']).remove,['active']);
});
test("normalização preserva medidas, barra e polegada",()=>{
  assert.equal(normalizeCatalogSearch(' 16mm  x  1/2" '),'16mm x 1/2"');
  assert.deepEqual(catalogSearchTokens('16mm x 1/2"'),['16mm','x','1/2']);
});
test("sinônimos incluem regionais e comerciais",()=>{
  assert.ok(expandCatalogSearchTerms('cano 20 mm').includes('tubo 20 mm'));
  assert.ok(expandCatalogSearchTerms('esquenta pinto').some((x)=>x.includes('lampada de aquecimento')));
});
test("ranking objetivo prioriza SKU, GTIN, nome e depois atributos",()=>{
  const terms=expandCatalogSearchTerms('PA016045');
  const sku=catalogSearchScore({query:'PA016045',terms,name:'Outro',sku:'PA016045'});
  const name=catalogSearchScore({query:'PA016045',terms,name:'PA016045'});
  assert.ok(sku>name);
});
test("golden set é versionado e cobre gates obrigatórios",async()=>{
  const golden=JSON.parse(await readFile(new URL('./fixtures/catalog-search-golden.json',import.meta.url),'utf8'));
  for(const query of ['disjuntor','3/4','cano','16mm x 1/2"','7898959829413'])assert.ok(golden.some((x)=>x.query===query));
  assert.ok(golden.length>=14);
});
test("importer mantém preço, estoque reservado e aggregate na mesma transação",async()=>{
  const source=await readFile(new URL('../scripts/database/catalog-import/import.mjs',import.meta.url),'utf8');
  const pricingMigration=await readFile(new URL('../supabase/migrations/20260823110300_pricing.sql',import.meta.url),'utf8');
  assert.doesNotMatch(source,/insert\s+into\s+public\.price_history/i);
  assert.match(pricingMigration,/create\s+trigger\s+prices_capture_history/i);
  assert.match(pricingMigration,/execute\s+function\s+public\.capture_price_history\(\)/i);
  assert.match(source,/INVENTORY_RESERVED_CONFLICT/);assert.match(source,/this\.sql\.begin/);
  for(const area of ['syncCategories','syncMedia','syncPim','pricing','inventory'])assert.match(source,new RegExp(area));
});
