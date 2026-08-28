import { createHash } from "node:crypto";
import type { CatalogDataSource, CatalogFeatureFlags } from "./flags.ts";

export const CATALOG_COHORT_COOKIE = "persi_catalog_cohort";
export const CATALOG_BUCKETS = 10_000;
export const CATALOG_COHORT_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 };

export function isValidCohort(value: string | null | undefined): value is string { return Boolean(value && /^[A-Za-z0-9_-]{22,64}$/.test(value)); }
export function catalogBucket(cohort: string): number { const digest=createHash("sha256").update(`persi-catalog-v1:${cohort}`).digest();return digest.readUInt32BE(0)%CATALOG_BUCKETS; }
export function decideCatalogSource(flags:CatalogFeatureFlags,cohort?:string|null):CatalogDataSource { if(flags.dataSource!=="postgres"||flags.canaryPercent<=0||!isValidCohort(cohort))return"woocommerce";return catalogBucket(cohort)<Math.floor(flags.canaryPercent*100)?"postgres":"woocommerce"; }
export async function withCatalogFallback<T>(input:{source:CatalogDataSource;postgres:()=>Promise<T>;woo:()=>Promise<T>;timeoutMs:number;onFallback?:(reason:"timeout"|"postgres_error",latencyMs:number)=>void}):Promise<{value:T;source:CatalogDataSource;fallback:boolean}>{if(input.source==="woocommerce")return{value:await input.woo(),source:"woocommerce",fallback:false};const started=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;try{const value=await Promise.race([input.postgres(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("CATALOG_POSTGRES_TIMEOUT")),input.timeoutMs)})]);return{value,source:"postgres",fallback:false};}catch(error){const reason=error instanceof Error&&error.message==="CATALOG_POSTGRES_TIMEOUT"?"timeout":"postgres_error";input.onFallback?.(reason,performance.now()-started);return{value:await input.woo(),source:"woocommerce",fallback:true};}finally{if(timer)clearTimeout(timer);}}
