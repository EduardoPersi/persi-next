import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {acquireOneShot,markAttemptedUnknown,markCompleted,markPreSendFailed,readOneShotState} from "../scripts/database/pim-ai-one-shot-guard.mjs";

async function fixture(run){const root=await mkdtemp(join(tmpdir(),"persi-pim-guard-"));try{return await run(join(root,"missing-parent","marker.json"));}finally{await rm(root,{recursive:true,force:true});}}
test("cria parent inexistente e marker PREPARED",()=>fixture(async marker=>{const result=await acquireOneShot(marker);assert.equal(result.acquired,true);assert.equal(JSON.parse(await readFile(marker,"utf8")).state,"PREPARED");}));
test("segunda aquisição é bloqueada",()=>fixture(async marker=>{assert.equal((await acquireOneShot(marker)).acquired,true);assert.equal((await acquireOneShot(marker)).acquired,false);}));
test("aquisições concorrentes possuem exatamente um vencedor",()=>fixture(async marker=>{const results=await Promise.all(Array.from({length:10},()=>acquireOneShot(marker)));assert.equal(results.filter(x=>x.acquired).length,1);assert.equal(results.filter(x=>!x.acquired).length,9);}));
test("falha pré-envio é distinguível e permanece bloqueada",()=>fixture(async marker=>{await acquireOneShot(marker);await markPreSendFailed(marker,"synthetic-offline-failure");const state=await readOneShotState(marker);assert.equal(state.state,"PRE_SEND_FAILED");assert.equal(state.requestDefinitelyNotSent,true);assert.equal((await acquireOneShot(marker)).acquired,false);}));
test("estado unknown é conservador e permanece bloqueado",()=>fixture(async marker=>{await acquireOneShot(marker);await markAttemptedUnknown(marker);const state=await readOneShotState(marker);assert.equal(state.state,"ATTEMPTED_UNKNOWN");assert.equal(state.requestDefinitelyNotSent,false);assert.equal((await acquireOneShot(marker)).acquired,false);}));
test("transição sent/completed permanece bloqueada e não usa rede",()=>fixture(async marker=>{let networkCalls=0;await acquireOneShot(marker);await markAttemptedUnknown(marker);const fakeResponse=()=>{networkCalls++;return{status:"completed"};};await markCompleted(marker,{requestStatus:fakeResponse().status});assert.equal((await readOneShotState(marker)).state,"COMPLETED");assert.equal((await acquireOneShot(marker)).acquired,false);assert.equal(networkCalls,1);}));
