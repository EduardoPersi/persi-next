import assert from "node:assert/strict";
import test from "node:test";
import { SemanticReadiness, semanticProbePassed, waitForSemanticReadiness, redactDiagnostic } from "../scripts/database/runtime-identity-readiness.mjs";
test("pg readiness alone is insufficient",()=>assert.equal(semanticProbePassed({initComplete:false,databaseReady:true}),false));
test("failures wait and reset the stability window",()=>{const state=new SemanticReadiness(3);assert.equal(state.observe(true),false);assert.equal(state.observe(false),false);assert.equal(state.consecutive,0);assert.equal(state.regressions,1);assert.equal(state.observe(true),false);assert.equal(state.observe(true),false);assert.equal(state.observe(true),true);});
test("N consecutive semantic successes produce READY",()=>{const state=new SemanticReadiness(2);assert.equal(state.observe(true),false);assert.equal(state.observe(true),true);});
test("timeout fails closed",async()=>{let clock=0;await assert.rejects(waitForSemanticReadiness({probe:async()=>false,timeoutMs:3,pollMs:1,now:()=>clock,pause:async ms=>{clock+=ms;}}),/R4_A_SUPABASE_BOOTSTRAP_TIMEOUT/);});
test("diagnostics redact credentials",()=>{const secret="never-print-this";const result=redactDiagnostic(`postgresql://user:${secret}@localhost/db ${secret}`,[secret]);assert.doesNotMatch(result,new RegExp(secret));assert.match(result,/REDACTED/);});
