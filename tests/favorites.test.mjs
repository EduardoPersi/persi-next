import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Customer Lists usa storage único e migra favoritos legados", () => {
  const storage = read("lib/customer-lists/storage.ts");
  const sync = read("lib/customer-lists/sync.ts");
  assert.match(storage, /CUSTOMER_LISTS_STORAGE_KEY = "customer_lists"/);
  assert.match(storage, /persi_favorite_products/);
  assert.match(sync, /CUSTOMER_LIST_TYPES/);
  assert.match(sync, /clearStoredCustomerLists\(\)/);
});

test("API autenticada expõe endpoints genéricos para listas", () => {
  const controller = read("wordpress-plugin/persi-headless-account/src/Api/CustomerListsController.php");
  const repository = read("wordpress-plugin/persi-headless-account/src/CustomerLists/CustomerListRepository.php");
  assert.match(controller, /\/customer-lists\/\(\?P<list_type>/);
  assert.match(controller, /\/sync/);
  assert.match(controller, /WP_REST_Server::DELETABLE/);
  assert.match(controller, /RequestAuthenticator/);
  assert.match(repository, /user_id, list_type, product_id/);
});

test("Favoritos é wrapper de Customer Lists", () => {
  const context = read("lib/favorites/favorites-context.tsx");
  const api = read("lib/favorites/favorites-api.ts");
  assert.match(context, /useCustomerLists/);
  assert.match(context, /customerLists\.toggle\("favorites"/);
  assert.match(api, /customerListsApi\.list\("favorites"\)/);
});

test("página de favoritos não é indexável", () => {
  const page = read("app/favoritos/page.tsx");
  assert.match(page, /index:false,follow:false/);
});
