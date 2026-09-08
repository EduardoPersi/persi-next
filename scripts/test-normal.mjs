import {spawnSync} from "node:child_process";
import {readFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";

const root=process.cwd();
const evidenceManifest=JSON.parse(readFileSync(resolve(root,"tests/evidence/pim/manifest.json"),"utf8"));
const evidenceFiles=new Set(evidenceManifest.tests.filter(item=>item.location==="tests-root").map(item=>item.path.replace(/^tests\//,"")));
const pimOnly=process.argv.includes("--pim");
const files=readdirSync(resolve(root,"tests"),{withFileTypes:true})
 .filter(entry=>entry.isFile()&&entry.name.endsWith(".test.mjs"))
 .map(entry=>entry.name)
 .filter(name=>!evidenceFiles.has(name))
 .filter(name=>!pimOnly||/^pim/i.test(name))
 .sort()
 .map(name=>`tests/${name}`);

if(files.length===0)throw new Error("NORMAL_TEST_DISCOVERY_EMPTY");
for(const file of files){
 const source=readFileSync(resolve(root,file),"utf8");
 if(/supabase[\\/].temp[\\/]pim-ai|\.temp[\\/]pim-ai/.test(source)){
  throw new Error(`NORMAL_TEST_DEPENDS_ON_IGNORED_PIM_ARTIFACT:${file}`);
 }
}

const result=spawnSync(process.execPath,["--conditions=react-server","--experimental-loader","./scripts/database/typescript-loader.mjs","--test",...files],{
 cwd:root,
 env:{...process.env,PERSI_OFFLINE_VALIDATION:"1"},
 stdio:"inherit",
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
