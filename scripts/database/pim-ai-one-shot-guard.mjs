import {mkdir,open,readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const PROJECT_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
export const DEFAULT_MARKER_PATH=resolve(PROJECT_ROOT,"supabase/.temp/pim-ai/p3c-real-1.json");
export const P3C_REAL_1C_MARKER_PATH=resolve(PROJECT_ROOT,"supabase/.temp/pim-ai/p3c-real-1c.json");

async function readState(markerPath){return JSON.parse(await readFile(markerPath,"utf8"));}
async function replaceState(markerPath,state,details={}){const current=await readState(markerPath);const next={...current,state,...details,updatedAt:new Date().toISOString()};await writeFile(markerPath,JSON.stringify(next,null,2),"utf8");return next;}

export async function acquireOneShot(markerPath=DEFAULT_MARKER_PATH,test="P.3C-REAL-1"){
 await mkdir(dirname(markerPath),{recursive:true});
 let handle;
 try{handle=await open(markerPath,"wx");}
 catch(error){if(error?.code==="EEXIST")return{acquired:false,state:await readState(markerPath)};throw error;}
 const state={test,state:"PREPARED",preparedAt:new Date().toISOString()};
 try{await handle.writeFile(JSON.stringify(state,null,2),"utf8");}finally{await handle.close();}
 return{acquired:true,state};
}
export const markPreSendFailed=(markerPath,reason)=>replaceState(markerPath,"PRE_SEND_FAILED",{requestDefinitelyNotSent:true,reason});
export const markAttemptedUnknown=(markerPath)=>replaceState(markerPath,"ATTEMPTED_UNKNOWN",{requestDefinitelyNotSent:false,attemptedAt:new Date().toISOString()});
export const markCompleted=(markerPath,details)=>replaceState(markerPath,"COMPLETED",{...details,completedAt:new Date().toISOString()});
export {readState as readOneShotState};
