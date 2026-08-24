import type { CatalogProduct } from "./domain.ts";

export type DifferenceSeverity = "critical" | "high" | "medium" | "low";
export interface CatalogDifference { field:string;severity:DifferenceSeverity;official:unknown;shadow:unknown; }

const normalizedText=(value:string|null|undefined)=>String(value??"").normalize("NFKC").replace(/\s+/g," ").trim();
const taxonomy=(items:CatalogProduct["categories"])=>items.map((item)=>`${item.externalId}:${normalizedText(item.slug).toLowerCase()}`).sort();
const terms=(items:CatalogProduct["attributes"])=>items.map((item)=>`${item.code}:${normalizedText(item.value).toLowerCase()}`).sort();
const urlPath=(value:string)=>{try{return new URL(value).pathname;}catch{return value;}};
const images=(items:CatalogProduct["images"])=>items.map((item)=>`${item.externalId??""}:${item.position}:${urlPath(item.url)}`).sort();

export function compareCatalogProducts(official:CatalogProduct|undefined,shadow:CatalogProduct|undefined):CatalogDifference[]{
  if(!official||!shadow)return[{field:"product",severity:"critical",official:official?.externalId??null,shadow:shadow?.externalId??null}];
  const differences:CatalogDifference[]=[];const compare=(field:string,severity:DifferenceSeverity,left:unknown,right:unknown)=>{if(JSON.stringify(left)!==JSON.stringify(right))differences.push({field,severity,official:left,shadow:right});};
  compare("externalId","critical",official.externalId,shadow.externalId);compare("slug","critical",official.slug,shadow.slug);compare("name","critical",normalizedText(official.name),normalizedText(shadow.name));compare("sku","critical",official.sku.trim().toUpperCase(),shadow.sku.trim().toUpperCase());compare("price.regularMinor","critical",String(official.price.regularMinor),String(shadow.price.regularMinor));compare("price.saleMinor","critical",official.price.saleMinor===null?null:String(official.price.saleMinor),shadow.price.saleMinor===null?null:String(shadow.price.saleMinor));
  compare("inventory.status","high",official.inventory.status,shadow.inventory.status);compare("brand","high",official.brand?.externalId??null,shadow.brand?.externalId??null);compare("categories","high",taxonomy(official.categories),taxonomy(shadow.categories));compare("attributes","medium",terms(official.attributes),terms(shadow.attributes));compare("images","medium",images(official.images),images(shadow.images));compare("gtin","medium",official.gtin??null,shadow.gtin??null);compare("description","low",normalizedText(official.description),normalizedText(shadow.description));return differences;
}

export function highestSeverity(differences:CatalogDifference[]):DifferenceSeverity|null {
  return (["critical","high","medium","low"] as const).find((severity)=>differences.some((item)=>item.severity===severity))??null;
}
