import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("scripts/database/runtime-identity-functional-validation.mjs", "utf8");

test("R4-C harness is offline, disposable, authentic-role and hash pinned", () => {
  assert.match(source, /PERSI_OFFLINE_VALIDATION_REQUIRED/);
  assert.match(source, /--pull", "never/);
  assert.match(source, /--tmpfs/);
  assert.match(source, /set local role persi_app/);
  assert.match(source, /persi_app_login/);
  assert.match(source, /5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec/);
  assert.match(source, /09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a/);
  assert.match(source, /transformCheckoutPiiToDurableTaxDocument/);
  assert.match(source, /submit_native_checkout/);
});
