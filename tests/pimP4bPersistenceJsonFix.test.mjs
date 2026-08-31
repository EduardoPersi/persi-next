import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";

test("falha de binding permanece sem commit e fix exige nova autorização",()=>{const path="supabase/.temp/pim-ai/p4b-persistence/json-binding-fix.json";if(!existsSync(path))return;const value=JSON.parse(readFileSync(path,"utf8"));assert.equal(value.rootCause,"JSON_STRING_BOUND_AS_JSONB");assert.equal(value.payloadType,"object");assert.equal(value.evidenceType,"array");assert.equal(value.priorInsertAttempts,1);assert.equal(value.priorInsertedRows,0);assert.equal(value.suggestionsAfter,value.suggestionsBefore);assert.equal(value.stagingWrites,0);assert.equal(value.pimSuggestionsCreated,0);assert.equal(value.safeToRequestNewWriteAuthorization,true);assert.equal(value.safeToRetryUnderConsumedAuthorization,false);});
