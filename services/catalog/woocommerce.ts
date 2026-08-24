import type { CatalogProduct } from "@/lib/catalog/domain";
import type { Product } from "@/types/product";

const toMinor=(value:number|undefined,minorUnit:number)=>value===undefined?null:BigInt(Math.round(value*10**minorUnit));

export function mapWooProductToCatalog(product:Product):CatalogProduct {
  const minorUnit=product.currencyMinorUnit,regular=toMinor(product.regularPrice??product.price,minorUnit)??BigInt(0),sale=toMinor(product.salePrice,minorUnit);
  return{source:"woocommerce",externalId:product.id,internalId:null,slug:product.slug,name:product.name,sku:product.sku,gtin:product.ean??null,status:"active",shortDescription:product.shortDescription,description:product.description,publishedAt:product.dateCreated??null,price:{currency:product.currencyCode,regularMinor:regular,saleMinor:sale,saleValidFrom:null,saleValidTo:null},inventory:{quantityAvailable:BigInt(product.stockQuantity??0),status:product.available?"in-stock":"out-of-stock"},brand:product.brands[0]?{externalId:product.brands[0].id,name:product.brands[0].name,slug:product.brands[0].slug}:null,categories:product.categories.map((item)=>({externalId:item.id,name:item.name,slug:item.slug})),images:product.images.map((item,index)=>({externalId:item.id??null,url:item.src,alt:item.alt,title:item.name??null,role:index===0?"primary":"gallery",position:index})),attributes:product.attributes.flatMap((attribute)=>attribute.options.map((option)=>({code:attribute.taxonomy??attribute.name,name:attribute.name,value:option.label})))};
}
