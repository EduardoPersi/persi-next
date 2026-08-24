import { compareCatalogProducts, highestSeverity, type CatalogDifference } from "./comparison.ts";
import type { CatalogProduct } from "./domain.ts";
import { getCatalogFeatureFlags, shouldSampleShadow } from "./flags.ts";

export interface ShadowEvent {timestamp:string;requestType:string;sourceIdentifier:string;wooDurationMs:number;postgresDurationMs:number|null;match:boolean;severity:string|null;fields:string[];error?:"timeout"|"postgres";}
interface ShadowDependencies {official:()=>Promise<CatalogProduct|undefined>;shadow:()=>Promise<CatalogProduct|undefined>;log?:(event:ShadowEvent)=>void;random?:()=>number;flags?:ReturnType<typeof getCatalogFeatureFlags>;}

export async function officialReadWithShadow(requestType:string,sourceIdentifier:string,dependencies:ShadowDependencies):Promise<CatalogProduct|undefined>{
  const flags=dependencies.flags??getCatalogFeatureFlags(),officialStart=performance.now(),official=await dependencies.official(),wooDurationMs=performance.now()-officialStart;if(!shouldSampleShadow(flags,dependencies.random))return official;
  void compareInBackground(requestType,sourceIdentifier,official,wooDurationMs,flags.shadowTimeoutMs,dependencies);return official;
}

async function compareInBackground(requestType:string,sourceIdentifier:string,official:CatalogProduct|undefined,wooDurationMs:number,timeoutMs:number,dependencies:ShadowDependencies):Promise<void>{
  const started=performance.now();try{const shadow=await Promise.race([dependencies.shadow(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("SHADOW_TIMEOUT")),timeoutMs))]),differences:CatalogDifference[]=compareCatalogProducts(official,shadow);dependencies.log?.({timestamp:new Date().toISOString(),requestType,sourceIdentifier,wooDurationMs,postgresDurationMs:performance.now()-started,match:differences.length===0,severity:highestSeverity(differences),fields:differences.map((item)=>item.field)});}catch(error){dependencies.log?.({timestamp:new Date().toISOString(),requestType,sourceIdentifier,wooDurationMs,postgresDurationMs:performance.now()-started,match:false,severity:null,fields:[],error:error instanceof Error&&error.message==="SHADOW_TIMEOUT"?"timeout":"postgres"});}
}
