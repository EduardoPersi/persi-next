import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATABASE_WARN_BYTES=300*1024*1024;
export const DATABASE_STOP_BYTES=400*1024*1024;
export function createCheckpoint({source,target,total}){return{version:1,runId:crypto.randomUUID(),source,target,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),total,lastSuccessfulPage:0,processed:0,imported:0,updated:0,noop:0,skipped:0,conflicts:0,failed:0,completedExternalIds:[],failures:[]};}
export function recordCheckpoint(checkpoint,{externalId,page,status,error=null}){if(checkpoint.completedExternalIds.includes(String(externalId)))return checkpoint;const next={...checkpoint,updatedAt:new Date().toISOString(),lastSuccessfulPage:Math.max(checkpoint.lastSuccessfulPage,page),processed:checkpoint.processed+1,completedExternalIds:[...checkpoint.completedExternalIds,String(externalId)]};if(["imported","updated","noop","skipped","conflicts","failed"].includes(status))next[status]+=1;if(error)next.failures=[...checkpoint.failures,{externalId:String(externalId),classification:classifyFailure(error),message:String(error.message??error)}];return next;}
export function pendingExternalIds(checkpoint,allIds){const done=new Set(checkpoint.completedExternalIds);return allIds.map(String).filter((id)=>!done.has(id));}
export function saveCheckpoint(file,checkpoint){fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=`${file}.${process.pid}.tmp`;fs.writeFileSync(temporary,JSON.stringify(checkpoint,null,2));fs.renameSync(temporary,file);}
export function loadCheckpoint(file){return JSON.parse(fs.readFileSync(file,"utf8"));}
export function classifyFailure(error){const code=String(error?.code??"");const status=Number(error?.status);if(["28P01","3D000","42P01","57P01"].includes(code)||/auth|schema|database|connection/i.test(String(error?.message)))return"system";if(status===429||status>=500||/woo|source|fetch/i.test(String(error?.message)))return"source";return"record";}
export function shouldAbortFailure(error){return classifyFailure(error)!=="record";}
export function databaseThreshold(bytes){const value=Number(bytes);return value>=DATABASE_STOP_BYTES?"stop":value>=DATABASE_WARN_BYTES?"warn":"ok";}
export function progressLine(checkpoint){const percent=checkpoint.total?checkpoint.processed/checkpoint.total*100:0;return`[${checkpoint.processed}/${checkpoint.total}] ${percent.toFixed(1)}% | imported=${checkpoint.imported} | updated=${checkpoint.updated} | no-op=${checkpoint.noop} | conflicts=${checkpoint.conflicts} | failed=${checkpoint.failed}`;}
