import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { createExpectedErrorTracker, expectPgErrorAtSavepoint, extractPostgresSqlState } from "../scripts/database/runtime-identity-expected-error.mjs";

class FakeTransaction {
  constructor() { this.commands = []; this.aborted = false; }
  async savepoint(name, action) {
    this.commands.push(`savepoint ${name}`);
    try { return await action(this); }
    catch (error) { this.commands.push(`rollback to savepoint ${name}`); this.aborted = false; this.commands.push(`release savepoint ${name}`); throw error; }
  }
  async unsafe(command) {
    this.commands.push(command);
    if (command.startsWith("rollback to savepoint ")) { this.aborted = false; return []; }
    if (this.aborted) { const error = new Error("aborted"); error.code = "25P02"; throw error; }
    return [{ ok: 1 }];
  }
  fail(code) { this.aborted = true; throw new postgres.PostgresError({ message:"synthetic", code, severity:"ERROR" }); }
}

test("expected SQLSTATE is recovered at savepoint and following SQL succeeds", async () => {
  const tx = new FakeTransaction();
  const tracker = createExpectedErrorTracker();
  await expectPgErrorAtSavepoint(tx, { label: "DIRECT_DML", expected: "42501", tracker, operation: () => tx.fail("42501") });
  assert.deepEqual(tracker, { total: 1, correct: 1, missingSqlstates: 0, wrongSqlstates: 0, contaminations: 0, unexpectedSuccesses: 0, sequence: 1 });
  assert.deepEqual(tx.commands, ["savepoint r4a_expected_1", "rollback to savepoint r4a_expected_1", "release savepoint r4a_expected_1", "select 1"]);
  assert.equal(tx.aborted, false);
});

test("wrong SQLSTATE fails after recovering transaction state", async () => {
  const tx = new FakeTransaction();
  const tracker = createExpectedErrorTracker();
  await assert.rejects(expectPgErrorAtSavepoint(tx, { label: "WRONG_CODE", expected: "42501", tracker, operation: () => tx.fail("P0002") }), /EXPECTED_ERROR_WRONG_SQLSTATE:P0002/);
  assert.equal(tx.aborted, false);
  assert.equal(tracker.wrongSqlstates, 1);
});

test("25P02 is contamination, never successful denial evidence", async () => {
  const tx = new FakeTransaction();
  const tracker = createExpectedErrorTracker();
  await assert.rejects(expectPgErrorAtSavepoint(tx, { label: "CONTAMINATION", expected: "42501", tracker, operation: () => tx.fail("25P02") }), /EXPECTED_ERROR_WRONG_SQLSTATE:25P02/);
  assert.equal(tracker.contaminations, 1);
  assert.equal(tracker.correct, 0);
});

test("unexpected success rolls back its savepoint and fails", async () => {
  const tx = new FakeTransaction();
  const tracker = createExpectedErrorTracker();
  await assert.rejects(expectPgErrorAtSavepoint(tx, { label: "UNEXPECTED_SUCCESS", expected: "42501", tracker, operation: async () => {} }), /EXPECTED_ERROR_UNEXPECTED_SUCCESS/);
  assert.equal(tracker.unexpectedSuccesses, 1);
  assert.equal(tx.aborted, false);
});

test("strict normalizer accepts only verified PostgresError own enumerable code", () => {
  const fixture = code => new postgres.PostgresError({ message:"synthetic", code, severity:"ERROR" });
  assert.equal(extractPostgresSqlState(fixture("42501")), "42501");
  assert.equal(extractPostgresSqlState(fixture("25P02")), "25P02");
  assert.equal(extractPostgresSqlState(fixture("P0002")), "P0002");
  assert.equal(extractPostgresSqlState(new postgres.PostgresError({ message:"synthetic" })), null);
  assert.equal(extractPostgresSqlState(fixture(42501)), null);
  assert.equal(extractPostgresSqlState(fixture("4250")), null);
  assert.equal(extractPostgresSqlState(fixture("425010")), null);
  assert.equal(extractPostgresSqlState(fixture("p0002")), null);
  assert.equal(extractPostgresSqlState(Object.assign(new Error("network"), { code:"ECONNREFUSED" })), null);
  assert.equal(extractPostgresSqlState(new Error("42501")), null);
  assert.equal(extractPostgresSqlState(new Error("permission denied")), null);
  assert.equal(extractPostgresSqlState({ metadata:{ sqlstate:"42501" } }), null);
});
