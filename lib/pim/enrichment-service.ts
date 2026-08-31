import "server-only";
import {sql} from "drizzle-orm";
import {getDatabase} from "@/lib/db";
import {PimAttributeExtractor} from "./extractor";
import {createPimSourceFingerprint} from "./fingerprint";
import {MAX_AI_PRODUCTS_PER_RUN,PIM_PROMPT_VERSION,type PimEnrichmentContext} from "./enrichment-types";
import type {PimEnrichmentProvider} from "./enrichment-provider";

export async function getPimEnrichmentContext(productId:string):Promise<PimEnrichmentContext>{
 const rows=await getDatabase().execute(sql`select p.id "productId",p.name title,p.description,v.sku,v.gtin,b.name brand,c.name category from products p join lateral(select * from product_variants v where v.product_id=p.id order by v.created_at,v.id limit 1)v on true left join brands b on b.id=p.brand_id left join categories c on c.id=p.primary_category_id where p.id=${productId}::uuid`);
 const source=(rows as unknown as Array<Omit<PimEnrichmentContext,"attributes">>)[0];if(!source)throw new Error("Produto não encontrado.");
 const attributes=await getDatabase().execute(sql`select a.name,av.display_value value from product_attribute_values pav join attributes a on a.id=pav.attribute_id join attribute_values av on av.id=pav.attribute_value_id where pav.product_id=${productId}::uuid order by a.name,av.display_value`);
 return {...source,attributes:attributes as unknown as Array<{name:string;value:string}>};
}

export async function generateDeterministicSuggestions(productId:string){
 const context=await getPimEnrichmentContext(productId),fingerprint=createPimSourceFingerprint(context),candidates=new PimAttributeExtractor().extract(context),db=getDatabase();
 return db.transaction(async tx=>{
  await tx.execute(sql`update pim_suggestions set superseded_at=now() where product_id=${productId}::uuid and status='needs_review' and superseded_at is null and source_fingerprint<>'' and source_fingerprint<>${fingerprint}`);
  for(const candidate of candidates)await tx.execute(sql`insert into pim_suggestions(product_id,field_name,suggested_value,source,confidence,status,evidence,provider_reference,suggestion_type,payload,provider,model_version,prompt_version,source_fingerprint,extraction_method,evidence_references) values(${productId}::uuid,${`attribute_${candidate.attribute}`},${candidate.value},'migration',${candidate.confidence},'needs_review',${candidate.evidence.map(x=>`${x.sourceType}: ${x.rawValue}`).join("\n")},'deterministic-rules-v1','attribute',${JSON.stringify(candidate)}::jsonb,'deterministic','rules-v1',${PIM_PROMPT_VERSION},${fingerprint},'deterministic',${JSON.stringify(candidate.evidence)}::jsonb) on conflict(product_id,field_name,source_fingerprint,provider,model_version,prompt_version) where status='needs_review' and superseded_at is null and source_fingerprint<>'' do update set updated_at=now(),payload=excluded.payload,evidence_references=excluded.evidence_references`);
  return {productId,fingerprint,candidates};
 });
}

export async function runPimProvider(products:ReadonlyArray<PimEnrichmentContext>,provider:PimEnrichmentProvider){
 if(products.length>MAX_AI_PRODUCTS_PER_RUN)throw new Error(`Limite de IA excedido: máximo ${MAX_AI_PRODUCTS_PER_RUN} produto por execução.`);
 return Promise.all(products.map(product=>provider.enrichProduct({productId:product.productId,name:product.title,description:product.description,sku:product.sku,gtin:product.gtin,brand:product.brand,category:product.category,attributes:product.attributes})));
}
