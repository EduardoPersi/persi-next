import fs from "node:fs";
import { readPrivateEnvironment } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { ATTRIBUTE_RULES, normalizeSku, parseCompositeMeasurement, resolveGtin } from "./normalize.mjs";
import { mapWooSalePeriod } from "./sync.mjs";

const gate=JSON.parse(fs.readFileSync("supabase/.temp/catalog-import/gate-100.json","utf8")),ids=new Set(gate.selected.map(Number));
const extractor=new WooReadOnlyExtractor(readPrivateEnvironment()),products=(await extractor.all("products")).filter((x)=>ids.has(x.id));
const skuOwners=new Map(),sku={valid:0,missing:0,duplicate:0,normalizationConflict:0},gtinOwners=new Map(),gtin={present:0,missing:0,duplicate:0,invalidOrSuspicious:0,conflict:0};
const brands=new Set(),categories=new Set(),pim={mapped:0,unmapped:0,ambiguous:0,ignored:0},promotions={sale:0,withBothDates:0,fromOnly:0,toOnly:0,withoutDates:0};let withImage=0,withoutImage=0,totalMedia=0;
for(const product of products){
  const normalized=normalizeSku(product.sku);if(!normalized.valid)sku.missing++;else{sku.valid++;const prior=skuOwners.get(normalized.normalized);if(prior&&prior!==product.id)sku.duplicate++;else skuOwners.set(normalized.normalized,product.id);if(normalized.original!==normalized.normalized&&skuOwners.has(normalized.original))sku.normalizationConflict++;}
  const resolved=resolveGtin(product);if(resolved.status==="valid"){gtin.present++;const prior=gtinOwners.get(resolved.value);if(prior&&prior!==product.id)gtin.duplicate++;else gtinOwners.set(resolved.value,product.id);}else if(resolved.status==="missing")gtin.missing++;else{gtin.invalidOrSuspicious++;if(resolved.status==="conflict")gtin.conflict++;}
  if(product.brands?.[0])brands.add(product.brands[0].id);for(const category of product.categories??[])categories.add(category.id);
  const imageCount=product.images?.length??0;totalMedia+=imageCount;if(imageCount)withImage++;else withoutImage++;
  if(product.sale_price){promotions.sale++;const period=mapWooSalePeriod(product);if(period.from&&period.to)promotions.withBothDates++;else if(period.from)promotions.fromOnly++;else if(period.to)promotions.toOnly++;else promotions.withoutDates++;}
  for(const attribute of product.attributes??[]){const rule=ATTRIBUTE_RULES.get(String(attribute.slug??"").toLowerCase()),count=attribute.options?.length??0;if(!rule)pim.unmapped+=count;else if(rule.entity==="brand")pim.ignored+=count;else pim.mapped+=count;for(const option of attribute.options??[]){if(/[x×]/i.test(option)&&!parseCompositeMeasurement(option))pim.ambiguous++;}}
}
const result={products:products.length,sku,gtin,promotions,pim,media:{withImage,withoutImage,totalReferences:totalMedia,average:totalMedia/products.length},brands:brands.size,categories:categories.size,requests:extractor.requests,retries:extractor.retries};
fs.writeFileSync("supabase/.temp/catalog-import/audit-100.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
