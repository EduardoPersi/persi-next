import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOverlayRegistry } from "../lib/ui/overlayRegistry.ts";

test("gerenciador mantém somente um overlay ativo", () => {
  const registry = createOverlayRegistry();
  const closed = [];
  registry.register("search", { close: () => closed.push("search") });
  registry.register("account", { close: () => closed.push("account") });

  registry.activate("search");
  assert.equal(registry.active(), "search");
  registry.activate("account");
  assert.deepEqual(closed, ["search"]);
  assert.equal(registry.active(), "account");
});

test("cleanup remove registro sem fechar overlay incorreto", () => {
  const registry = createOverlayRegistry();
  let closed = false;
  const unregister = registry.register("share", {
    close: () => {
      closed = true;
    },
  });
  registry.activate("share");
  unregister();
  registry.activate("lightbox");
  assert.equal(closed, false);
  assert.equal(registry.active(), "lightbox");
});

test("click outside usa pointerdown, composedPath, exceções e cleanup", async () => {
  const source = await readFile(
    new URL("../hooks/useClickOutside.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(!isOpen\) return/);
  assert.match(source, /"pointerdown"/);
  assert.match(source, /event\.composedPath\(\)/);
  assert.match(source, /ignoreRefs/);
  assert.match(source, /ignoreSelectors/);
  assert.match(source, /removeEventListener\("pointerdown"/);
  assert.equal(source.includes('"mousedown"'), false);
});

test("overlays elegíveis aderem ao gerenciador global", async () => {
  const files = await Promise.all(
    [
      "../components/Account/AccountDropdown.tsx",
      "../components/Header/ProductSearch.tsx",
      "../components/Header/Drawer.tsx",
      "../components/Product/ProductGallery.tsx",
      "../components/Product/ProductImageLightbox.tsx",
      "../components/Product/QuickViewModal.tsx",
      "../components/Product/ProductPaymentMethods.tsx",
      "../components/Category/CategoryFilters.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  for (const source of files) {
    assert.match(source, /useOverlayManager/);
  }
  assert.match(files[0], /useClickOutside/);
  assert.match(files[1], /useClickOutside/);
  assert.match(files[3], /useClickOutside/);
  assert.match(files[4], /useClickOutside/);
  assert.match(files[5], /useClickOutside/);
  assert.match(files[7], /useClickOutside/);
  assert.equal(files[1].includes('addEventListener("mousedown"'), false);
});

test("busca fecha sem limpar o termo e indica carregamento na lupa", async () => {
  const source = await readFile(
    new URL("../components/Header/ProductSearch.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\)/);
  assert.match(source, /onPointerDown=\{closeSearch\}/);
  assert.match(source, /<LoaderCircle/);
  assert.match(source, /bg-secondary/);
  assert.match(source, /animate-spin text-white/);
  assert.match(source, /if \(!canSuggest \|\| !isFocused\) return/);
  assert.doesNotMatch(
    source.match(/function closeSearch\(\)[\s\S]*?\n  \}/)?.[0] ?? "",
    /setQuery/,
  );
});
