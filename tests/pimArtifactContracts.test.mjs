import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const fixture=JSON.parse(await readFile(new URL("./fixtures/pim-artifacts/pipeline-contracts.v1.json",import.meta.url),"utf8"));

test("fixture PIM é explicitamente sintética e versionada",()=>{
 assert.equal(fixture.fixtureVersion,1);
 assert.equal(fixture.classification,"SYNTHETIC_CONTRACT_FIXTURE");
});

test("contrato de lote mantém one-shot, sequência e budget fechado",()=>{
 assert.equal(fixture.batch.attempts,fixture.batch.authorized);
 assert.ok(fixture.batch.responses<=fixture.batch.attempts);
 assert.equal(fixture.batch.retries,0);
 assert.equal(fixture.batch.sequential,true);
 assert.ok(BigInt(fixture.budget.spentUsdMicros)<=BigInt(fixture.budget.hardBudgetUsdMicros));
});

test("quarentena e replay recuperam somente conflitos seguros",()=>{
 assert.equal(fixture.quarantine.eligible+fixture.quarantine.quarantined,fixture.batch.authorized);
 assert.equal(fixture.quarantine.unsafeFactsAccepted,0);
 assert.equal(fixture.quarantine.silentPrecedence,0);
 assert.equal(fixture.conflicts.sourceConflictsBefore-fixture.conflicts.sourceConflictsAfter,fixture.conflicts.recoveredEligible);
 assert.equal(fixture.conflicts.unitGuessing,0);
});

test("marker e retomada impedem repetição silenciosa",()=>{
 assert.equal(fixture.marker.state,"COMPLETED");
 assert.equal(fixture.marker.attempts,1);
 assert.equal(fixture.marker.completed,1);
 assert.ok(fixture.marker.insertedRows<=1);
 assert.equal(fixture.resume.duplicateAttempts,0);
 assert.deepEqual(new Set([...fixture.resume.alreadyCompleted,...fixture.resume.pending]),new Set([1,2,3,4,5]));
});

test("persistência permanece needs_review, sem publicação ou acesso remoto",()=>{
 assert.equal(fixture.persistence.status,"needs_review");
 assert.equal(fixture.persistence.autoApprove,false);
 assert.equal(fixture.persistence.publish,false);
 assert.equal(fixture.persistence.exactHashRequired,true);
 assert.equal(fixture.persistence.unexpectedRows,0);
 assert.deepEqual(fixture.remote,{openAiCalls:0,stagingWrites:0,productionAccess:0,pimAiEnabledFinal:false});
});
