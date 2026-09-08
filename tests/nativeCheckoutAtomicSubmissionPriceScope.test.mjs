import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260905180000_native_checkout_atomic_submission.sql", import.meta.url),
  "utf8",
);

test("M29 scopes nested authoritative-price validation to the submitted checkout", () => {
  assert.match(
    migration,
    /where i\.checkout_session_id=s\.id and \(p\.price_id<>i\.price_id or p\.list_amount_minor<>i\.unit_regular_amount_minor or p\.effective_amount_minor<>i\.unit_effective_amount_minor or p\.price_fingerprint<>i\.price_fingerprint\)/,
  );
});
