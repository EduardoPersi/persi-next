import assert from "node:assert/strict";
import test from "node:test";
import {
  createSingleCartInitializer,
  LatestCartRequest,
} from "../lib/commerce/cartClient.ts";

test("inicialização concorrente executa uma única requisição", async () => {
  let calls = 0;
  const initialize = createSingleCartInitializer(async () => {
    calls += 1;
    return { itemsCount: 0 };
  });

  const [first, second] = await Promise.all([initialize(), initialize()]);

  assert.equal(calls, 1);
  assert.strictEqual(first, second);
});

test("falha de inicialização permite uma nova tentativa", async () => {
  let calls = 0;
  const initialize = createSingleCartInitializer(async () => {
    calls += 1;
    if (calls === 1) throw new Error("indisponível");
    return { itemsCount: 0 };
  });

  await assert.rejects(initialize(), /indisponível/);
  assert.deepEqual(await initialize(), { itemsCount: 0 });
  assert.equal(calls, 2);
});

test("somente a resposta mais recente pode atualizar o estado", () => {
  const requests = new LatestCartRequest();
  const olderRequest = requests.start();
  const latestRequest = requests.start();

  assert.equal(requests.isLatest(olderRequest), false);
  assert.equal(requests.isLatest(latestRequest), true);
});
