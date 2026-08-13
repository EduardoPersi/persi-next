import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../components/Header/MiniCart.tsx", import.meta.url),
  "utf8",
);

test("mini carrinho respeita viewport dinâmica e área segura no celular", () => {
  assert.match(source, /h-\[100dvh\]/);
  assert.match(source, /max-h-\[100dvh\]/);
  assert.match(source, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(source, /\bh-screen\b/);
});

test("somente o conteúdo central rola e o rodapé permanece visível", () => {
  assert.match(source, /min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain/);
  assert.match(source, /<footer className="shrink-0/);
});
