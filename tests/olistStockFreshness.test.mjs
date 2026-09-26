import assert from "node:assert/strict";
import test from "node:test";
import { checkCartStockAvailability } from "../lib/commerce/olistStockFreshness.ts";

const ITEM = { productVariantId: "11111111-1111-1111-1111-111111111111", quantity: 5n };

test("checkCartStockAvailability is a no-op ('skipped') when the feature flag is off", async () => {
  const deps = {
    resolveOlistProductId: async () => { throw new Error("should not be called"); },
    getOlistProductStock: async () => { throw new Error("should not be called"); },
    readLocalFreshness: async () => { throw new Error("should not be called"); },
  };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, {});
  assert.deepEqual(result, { ok: true, source: "skipped" });
});

test("checkCartStockAvailability skips items with no Olist mapping", async () => {
  const deps = {
    resolveOlistProductId: async () => null,
    getOlistProductStock: async () => { throw new Error("should not be called"); },
    readLocalFreshness: async () => { throw new Error("should not be called"); },
  };
  const env = { OLIST_LIVE_STOCK_CHECK_ENABLED: "true" };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, env);
  assert.deepEqual(result, { ok: true, source: "olist_live" });
});

test("checkCartStockAvailability blocks when the live Olist balance is below the requested quantity", async () => {
  const deps = {
    resolveOlistProductId: async () => 42,
    getOlistProductStock: async () => ({ idProduto: 42, saldoFisico: 3, saldoDisponivel: 3 }),
    readLocalFreshness: async () => { throw new Error("should not be called"); },
  };
  const env = { OLIST_LIVE_STOCK_CHECK_ENABLED: "true" };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, env);
  assert.deepEqual(result, { ok: false, reason: "insufficient_stock", productVariantId: ITEM.productVariantId });
});

test("checkCartStockAvailability allows the sale when live balance is sufficient", async () => {
  const deps = {
    resolveOlistProductId: async () => 42,
    getOlistProductStock: async () => ({ idProduto: 42, saldoFisico: 10, saldoDisponivel: 10 }),
    readLocalFreshness: async () => { throw new Error("should not be called"); },
  };
  const env = { OLIST_LIVE_STOCK_CHECK_ENABLED: "true" };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, env);
  assert.deepEqual(result, { ok: true, source: "olist_live" });
});

test("checkCartStockAvailability falls back to local data (fresh + sufficient) when Olist is unreachable", async () => {
  const deps = {
    resolveOlistProductId: async () => 42,
    getOlistProductStock: async () => { throw new Error("OLIST_UNAVAILABLE"); },
    readLocalFreshness: async () => ({ quantityAvailable: 10n, lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
  };
  const env = { OLIST_LIVE_STOCK_CHECK_ENABLED: "true", OLIST_STOCK_FRESHNESS_MAX_MINUTES: "30" };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, env);
  assert.deepEqual(result, { ok: true, source: "local_fallback" });
});

test("checkCartStockAvailability blocks (stale_local_data) when the fallback data is older than the configured freshness window", async () => {
  const deps = {
    resolveOlistProductId: async () => 42,
    getOlistProductStock: async () => { throw new Error("OLIST_UNAVAILABLE"); },
    readLocalFreshness: async () => ({ quantityAvailable: 10n, lastSyncedAt: new Date(Date.now() - 45 * 60_000).toISOString() }),
  };
  const env = { OLIST_LIVE_STOCK_CHECK_ENABLED: "true", OLIST_STOCK_FRESHNESS_MAX_MINUTES: "30" };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, env);
  assert.deepEqual(result, { ok: false, reason: "stale_local_data", productVariantId: ITEM.productVariantId });
});

test("checkCartStockAvailability blocks (insufficient_stock) via the fallback when local data is fresh but quantity is too low", async () => {
  const deps = {
    resolveOlistProductId: async () => 42,
    getOlistProductStock: async () => { throw new Error("OLIST_UNAVAILABLE"); },
    readLocalFreshness: async () => ({ quantityAvailable: 2n, lastSyncedAt: new Date().toISOString() }),
  };
  const env = { OLIST_LIVE_STOCK_CHECK_ENABLED: "true" };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, env);
  assert.deepEqual(result, { ok: false, reason: "insufficient_stock", productVariantId: ITEM.productVariantId });
});

test("checkCartStockAvailability blocks (stale_local_data) when there is no fallback freshness data at all", async () => {
  const deps = {
    resolveOlistProductId: async () => 42,
    getOlistProductStock: async () => { throw new Error("OLIST_UNAVAILABLE"); },
    readLocalFreshness: async () => null,
  };
  const env = { OLIST_LIVE_STOCK_CHECK_ENABLED: "true" };
  const result = await checkCartStockAvailability([ITEM], { stage: "prepare", role: "persi_app" }, deps, env);
  assert.deepEqual(result, { ok: false, reason: "stale_local_data", productVariantId: ITEM.productVariantId });
});
