import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { truncateText } from "../lib/formatting/truncateText.ts";

test("resumo preserva palavras e só acrescenta reticências quando corta", () => {
  assert.equal(truncateText("materiais de alta qualidade para sua obra", 19), "materiais de alta...");
  assert.equal(truncateText("materiais de alta qualidade", "materiais de alta qualidade".length), "materiais de alta qualidade");
  assert.equal(truncateText("  materiais\n de alta qualidade  ", 17), "materiais de alta...");
  assert.equal(truncateText("impermeabilização resistente", 5), "impermeabilização...");
  assert.equal(truncateText("impermeabilização", 5), "impermeabilização");
  assert.equal(truncateText("", 240), "");
});

test("GTM inicializa consentimento e Pixel antes dos eventos antecipados do React", async () => {
  const source = await readFile(new URL("../components/layout/GoogleTagManager.tsx", import.meta.url), "utf8");
  const script = source.match(/\{`([\s\S]*?)`\}/)[1].replace("${GTM_ID}", "GTM-TEST");
  const earlyEvents = [
    { event: "page_view", page_path: "/produto-teste" },
    { ecommerce: null },
    { event: "view_item", ecommerce: { items: [{ item_id: "123" }] } },
  ];
  const window = { dataLayer: [...earlyEvents] };
  const scripts = [];
  const document = {
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: (script) => scripts.push(script) } }],
  };
  runInNewContext(script, { window, document });
  assert.equal(window.dataLayer[0][0], "consent");
  assert.equal(window.dataLayer[0][2].ad_storage, "denied");
  assert.equal(window.dataLayer[1].event, "gtm.js");
  assert.deepEqual(window.dataLayer.slice(2), earlyEvents);
  assert.equal(scripts.length, 1);
  // Reproduz os gatilhos publicados: base em gtm.js, ViewContent em view_item.
  const tracked = [];
  for (const event of window.dataLayer) {
    if (event.event === "gtm.js") window.fbq = (...args) => tracked.push(args);
    if (event.event === "view_item") window.fbq("track", "ViewContent");
  }
  assert.deepEqual(tracked, [["track", "ViewContent"]]);
});
