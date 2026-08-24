import type { CatalogProduct } from "./domain.ts";

export type CatalogProductRow=Record<string,unknown>;
const asDate=(value:unknown)=>value instanceof Date?value.toISOString():typeof value==="string"?new Date(value).toISOString():null;
const asArray=<T>(value:unknown):T[]=>Array.isArray(value)?value as T[]:[];
const asBigInt=(value:unknown)=>BigInt(String(value??0));

export function mapPostgresProductRow(row:CatalogProductRow):CatalogProduct {
  const categories=asArray<Record<string,unknown>>(row.categories).map((item)=>({externalId:Number(item.externalId),name:String(item.name),slug:String(item.slug)}));
  const images=asArray<Record<string,unknown>>(row.images).map((item)=>({externalId:item.externalId===null?null:Number(item.externalId),url:String(item.url),alt:String(item.alt??""),title:item.title===null?null:String(item.title),role:String(item.role),position:Number(item.position)}));
  const attributes=asArray<Record<string,unknown>>(row.attributes).map((item)=>({code:String(item.code),name:String(item.name),value:String(item.value)}));
  const brandRow=row.brand&&typeof row.brand==="object"?row.brand as Record<string,unknown>:null,quantity=asBigInt(row.quantityAvailable);
  return{source:"postgres",externalId:Number(row.externalId),internalId:String(row.internalId),slug:String(row.slug),name:String(row.name),sku:String(row.sku),gtin:row.gtin===null?null:String(row.gtin),status:String(row.status),shortDescription:String(row.shortDescription??""),description:String(row.description??""),publishedAt:asDate(row.publishedAt),price:{currency:String(row.currency),regularMinor:asBigInt(row.regularMinor),saleMinor:row.saleMinor===null?null:asBigInt(row.saleMinor),saleValidFrom:asDate(row.saleValidFrom),saleValidTo:asDate(row.saleValidTo)},inventory:{quantityAvailable:quantity,status:quantity>BigInt(0)?"in-stock":"out-of-stock"},brand:brandRow?{externalId:Number(brandRow.externalId),name:String(brandRow.name),slug:String(brandRow.slug)}:null,categories,images,attributes};
}
