import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("frete grátis vem da classe oficial do WooCommerce com cache", async () => {
  const source = await readFile(
    new URL("services/woocommerce/freeShipping.ts", root),
    "utf8",
  );

  assert.match(source, /CLASS_SLUG = "frete-gratis"/);
  assert.match(source, /products\/shipping_classes/);
  assert.match(source, /shipping_class: shippingClass\.id/);
  assert.match(source, /CACHE_SECONDS = 300/);
  assert.match(source, /catch \(error\)/);
});

test("plugin não registra extensão de produto na Store API", async () => {
  const plugin = await readFile(
    new URL("wordpress-plugin/persi-headless/includes/class-plugin.php", root),
    "utf8",
  );

  assert.doesNotMatch(plugin, /Persi_Headless_Product_Flags/);
  assert.doesNotMatch(plugin, /product-flags/);
});
