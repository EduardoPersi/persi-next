import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientHttpStatus,
  withSingleRetry,
} from "../lib/network/retry.ts";

test("repete uma vez depois de falha transitória e então retorna", async () => {
  let attempts = 0;
  const result = await withSingleRetry(
    async () => ({ status: ++attempts === 1 ? 503 : 200 }),
    {
      shouldRetryResult: ({ status }) => isTransientHttpStatus(status),
      sleep: async () => {},
    },
  );

  assert.equal(attempts, 2);
  assert.equal(result.status, 200);
});

test("repete apenas uma vez quando a operação lança erro", async () => {
  let attempts = 0;
  await assert.rejects(
    withSingleRetry(
      async () => {
        attempts += 1;
        throw new Error("ETIMEDOUT");
      },
      { shouldRetryResult: () => false, sleep: async () => {} },
    ),
  );
  assert.equal(attempts, 2);
});

test("não repete erros HTTP permanentes", async () => {
  let attempts = 0;
  const result = await withSingleRetry(
    async () => ({ status: (attempts += 1) && 404 }),
    {
      shouldRetryResult: ({ status }) => isTransientHttpStatus(status),
      sleep: async () => {},
    },
  );
  assert.equal(attempts, 1);
  assert.equal(result.status, 404);
});

test("não amplifica HTTP 500 do WordPress", async () => {
  let attempts = 0;
  const result = await withSingleRetry(
    async () => ({ status: (attempts += 1) && 500 }),
    {
      shouldRetryResult: ({ status }) => isTransientHttpStatus(status),
      sleep: async () => {},
    },
  );

  assert.equal(attempts, 1);
  assert.equal(result.status, 500);
});
