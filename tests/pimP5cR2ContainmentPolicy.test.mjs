import test from "node:test";
import assert from "node:assert/strict";
import {classifyPimBatchSignal,evaluatePimQualityDegradation,PIM_QUALITY_DEGRADATION_POLICY} from "../lib/pim/batch-safety-policy.ts";

const decision=signal=>classifyPimBatchSignal(signal);

test("P5-C-R2-FIX separa quarentena local de hard stop de seguranca",()=>{
 assert.equal(decision("FOREIGN_EVIDENCE_REF_BLOCKED").action,"PRODUCT_QUARANTINE_CONTINUE"); // 1
 assert.equal(decision("FOREIGN_EVIDENCE_REF_REBOUNDED").action,"PASS"); // 2
 assert.equal(decision("FOREIGN_EVIDENCE_REF_BLOCKED").safetySystemWorked,true); // 3: ambiguous/no rebound stays quarantined
 assert.equal(decision("FOREIGN_EVIDENCE_ACCEPTED").action,"HARD_STOP"); // 4
 assert.equal(decision("CROSS_PRODUCT_EVIDENCE").action,"HARD_STOP"); // 5
 assert.equal(decision("CATALOG_WRONG_OWNERSHIP").action,"HARD_STOP"); // 6
 assert.equal(decision("RESOLVER_ACCEPTED_INCOMPATIBLE_EVIDENCE").action,"HARD_STOP"); // 7
 assert.equal(decision("VALIDATOR_MISSED_FOREIGN_EVIDENCE").action,"HARD_STOP"); // 8
 assert.equal(decision("AMBIGUOUS_REBOUND_ACCEPTED").action,"HARD_STOP"); // 9
 assert.equal(decision("UNSUPPORTED_EXPANSION_BLOCKED").action,"PRODUCT_QUARANTINE_CONTINUE"); // 10
 assert.equal(decision("UNSUPPORTED_EXPANSION_ACCEPTED").action,"HARD_STOP"); // 11
 assert.equal(decision("QUALITY_EDITORIAL_FAILURE").classification,"QUALITY_LOCAL"); // 12
 assert.equal(decision("SOURCE_INCOMPLETE").classification,"SOURCE_LOCAL"); // 13
 assert.equal(decision("DLP_FAILURE").action,"HARD_STOP"); // 14
 assert.equal(decision("UNEXPECTED_STAGING_WRITE").action,"HARD_STOP"); // 15
 assert.equal(decision("MARKER_CORRUPTION").action,"HARD_STOP"); // 16
 assert.equal(decision("PROVIDER_INDETERMINATE").action,"SAFE_ABORT"); // 17
 assert.equal(evaluatePimQualityDegradation(43,2),"PASS");
 assert.equal(evaluatePimQualityDegradation(20,4),"QUALITY_DEGRADATION_STOP"); // 18
});

test("quality degradation usa baseline historico e amostra minima",()=>{
 assert.deepEqual(PIM_QUALITY_DEGRADATION_POLICY.historicalBasis,{attempted:43,modelContractViolations:4,containedWithoutRebound:2});
 assert.equal(evaluatePimQualityDegradation(10,4),"PASS");
 assert.equal(evaluatePimQualityDegradation(25,4),"PASS");
 assert.equal(evaluatePimQualityDegradation(25,5),"QUALITY_DEGRADATION_STOP");
});
