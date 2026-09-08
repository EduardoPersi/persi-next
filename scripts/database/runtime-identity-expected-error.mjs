import assert from "node:assert/strict";
import postgres from "postgres";

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

export function extractPostgresSqlState(error) {
  if (!(error instanceof postgres.PostgresError)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) return null;
  return typeof descriptor.value === "string" && SQLSTATE_PATTERN.test(descriptor.value)
    ? descriptor.value
    : null;
}

export function describePostgresErrorShape(error) {
  const descriptor = error && Object.getOwnPropertyDescriptor(error, "code");
  return {
    constructor: error?.constructor?.name ?? null,
    ownPropertyNames: error ? Object.getOwnPropertyNames(error).filter(name => ["name", "message", "code", "severity", "severity_local", "detail", "hint", "position", "where", "schema_name", "table_name", "column_name", "constraint_name", "file", "line", "routine"].includes(name)) : [],
    codeOwn: Boolean(descriptor),
    codeEnumerable: descriptor?.enumerable === true,
    codeAccessor: Boolean(descriptor?.get || descriptor?.set),
    sqlstate: extractPostgresSqlState(error),
  };
}

export function createExpectedErrorTracker() {
  return {
    total: 0,
    correct: 0,
    missingSqlstates: 0,
    wrongSqlstates: 0,
    contaminations: 0,
    unexpectedSuccesses: 0,
    sequence: 0,
  };
}

function expectedCodes(value) {
  const codes = Array.isArray(value) ? value : [value];
  assert.ok(codes.length > 0, "EXPECTED_SQLSTATE_REQUIRED");
  for (const code of codes) assert.match(code, /^[0-9A-Z]{5}$/, "EXPECTED_SQLSTATE_INVALID");
  return codes;
}

function safeFailure(label, reason, actualCode) {
  const error = new Error(`${label}:${reason}:${actualCode ?? "NONE"}`);
  error.code = reason;
  return error;
}

export async function expectPgErrorAtSavepoint(tx, {
  label,
  operation,
  expected,
  tracker,
}) {
  assert.match(label, /^[A-Z0-9_]+$/, "EXPECTED_ERROR_LABEL_INVALID");
  assert.equal(typeof operation, "function", "EXPECTED_ERROR_OPERATION_REQUIRED");
  const allowed = expectedCodes(expected);
  const state = tracker ?? createExpectedErrorTracker();
  const savepoint = `r4a_expected_${++state.sequence}`;
  state.total++;
  let caught;
  try {
    await tx.savepoint(savepoint, async savepointSql => operation(savepointSql));
  } catch (error) {
    caught = error;
  }

  if (!caught) {
    state.unexpectedSuccesses++;
    throw safeFailure(label, "EXPECTED_ERROR_UNEXPECTED_SUCCESS");
  }
  const sqlstate = extractPostgresSqlState(caught);
  if (sqlstate === null) {
    state.missingSqlstates++;
    throw safeFailure(label, "EXPECTED_ERROR_MISSING_SQLSTATE");
  }
  if (sqlstate === "25P02") state.contaminations++;
  if (!allowed.includes(sqlstate)) {
    state.wrongSqlstates++;
    throw safeFailure(label, "EXPECTED_ERROR_WRONG_SQLSTATE", sqlstate);
  }

  try {
    await tx.unsafe("select 1");
  } catch (probeError) {
    const probeSqlstate = extractPostgresSqlState(probeError);
    if (probeSqlstate === "25P02") state.contaminations++;
    throw safeFailure(label, "EXPECTED_ERROR_POST_RECOVERY_PROBE_FAILED", probeSqlstate);
  }
  state.correct++;
  return caught;
}

export async function expectPgErrorInTransaction(client, options) {
  let result;
  await client.begin(async tx => {
    if (options.setup) await options.setup(tx);
    result = await expectPgErrorAtSavepoint(tx, options);
  });
  await client.unsafe("select 1");
  return result;
}
