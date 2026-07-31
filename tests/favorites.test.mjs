import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("favoritos anônimos armazenam somente IDs e fazem merge sem duplicatas", () => {
  const storage = read("lib/favorites/favorites-storage.ts");
  const sync = read("lib/favorites/favorites-sync.ts");
  assert.match(storage, /JSON\.stringify\(normalizeFavoriteIds\(ids\)\)/);
  assert.match(sync, /new Set/);
  assert.match(sync, /clearStoredFavorites\(\)/);
});

test("API autenticada cobre listagem, inclusão, remoção e sincronização", () => {
  const controller = read("wordpress-plugin/persi-headless-account/src/Api/FavoriteController.php");
  assert.match(controller, /persi-headless\/v1/);
  assert.match(controller, /\/favorites\/sync/);
  assert.match(controller, /WP_REST_Server::DELETABLE/);
  assert.match(controller, /RequestAuthenticator/);
});

test("página de favoritos não é indexável", () => {
  const page = read("app/favoritos/page.tsx");
  assert.match(page, /index:false,follow:false/);
});
