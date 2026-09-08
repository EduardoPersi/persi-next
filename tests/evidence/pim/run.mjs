import {spawnSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";

const root=process.cwd();
const artifactRoot=resolve(root,"supabase/.temp/pim-ai");
if(!existsSync(artifactRoot)){
 console.error("PIM_EVIDENCE_ARTIFACTS_MISSING: restore the private supabase/.temp/pim-ai evidence package; this command never downloads or regenerates it.");
 process.exit(2);
}
const manifest=JSON.parse(readFileSync(new URL("./manifest.json",import.meta.url),"utf8"));
const files=manifest.tests.map(item=>item.path);
const requiredArtifacts=new Set();
for(const file of files){
 const source=readFileSync(resolve(root,file),"utf8");
 for(const match of source.matchAll(/(?:\.\.\/)?supabase\/\.temp\/pim-ai\/[A-Za-z0-9._/-]+/g)){
  requiredArtifacts.add(match[0].replace(/^\.\.\//,""));
 }
}
const missing=[...requiredArtifacts].filter(path=>!existsSync(resolve(root,path)));
if(missing.length>0){
 console.error(`PIM_EVIDENCE_FILES_MISSING:\n${missing.map(path=>`- ${path}`).join("\n")}`);
 process.exit(2);
}
const result=spawnSync(process.execPath,["--conditions=react-server","--experimental-loader","./scripts/database/typescript-loader.mjs","--test",...files],{
 cwd:root,
 env:{...process.env,PERSI_OFFLINE_VALIDATION:"1"},
 stdio:"inherit",
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
