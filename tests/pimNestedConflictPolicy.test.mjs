import test from "node:test";
import assert from "node:assert/strict";
import {assertSuggestionDecisionAllowed} from "../lib/pim/conflict-policy.ts";

test("gate inspeciona reconciliação e auditoria aninhadas do payload persistido",()=>{assert.throws(()=>assertSuggestionDecisionAllowed({reconciliation:{acceptableForDraft:false}},"approved"),/PIM_BLOCKING_CONFLICT/);assert.throws(()=>assertSuggestionDecisionAllowed({postModelAudit:{finalPipelineSafety:"FAIL",hallucinations:1}},"approved"),/PIM_BLOCKING_CONFLICT/);assert.doesNotThrow(()=>assertSuggestionDecisionAllowed({reconciliation:{acceptableForDraft:true,blockingConflicts:[]},postModelAudit:{finalPipelineSafety:"PASS",hallucinations:0,protectedTermFalsePositives:[]}},"approved"));});
