import { readPrivateEnvironment } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
const extractor=new WooReadOnlyExtractor(readPrivateEnvironment()),ids=[23945,23941,9043],taxonomies=await extractor.all("products/attributes"),rows=[];
for(const id of ids){const product=(await extractor.get(`products/${id}`)).data;rows.push({wooId:id,brand:product.brands?.[0]??null,localAttributes:(product.attributes??[]).filter((x)=>!String(x.slug).startsWith("pa_")).map((x)=>({name:x.name,slug:x.slug,options:x.options})),globalAttributes:(product.attributes??[]).filter((x)=>String(x.slug).startsWith("pa_")).map((x)=>({name:x.name,slug:x.slug,options:x.options}))});}
console.log(JSON.stringify({taxonomies:taxonomies.map((x)=>({id:x.id,name:x.name,slug:x.slug})),rows,requests:extractor.requests,retries:extractor.retries},null,2));
