import type { CatalogDataSource } from "./flags.ts";
export const catalogCacheKey=(source:CatalogDataSource,resource:string,identifier:string)=>["catalog",source,resource,identifier];
export const catalogCacheTag=(source:CatalogDataSource,resource:string)=>`catalog:${source}:${resource}`;
