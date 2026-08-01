import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildCategoryTree, flattenCategoryTree } from "../lib/navigation/CategoryTree.ts";

const category = (id, name, slug, parent = 0) => ({
  id, name, slug, parent, description: "", count: id, permalink: `/${slug}`,
});

test("árvore preserva ordem da API e aceita níveis ilimitados", () => {
  const tree = buildCategoryTree([
    category(1, "Hidráulica", "hidraulica"),
    category(2, "Tubos", "tubos", 1),
    category(3, "PVC", "pvc", 2),
    category(4, "Soldável", "soldavel", 3),
    category(5, "Elétrica", "eletrica"),
  ]);
  assert.deepEqual(tree.map(({ id }) => id), [1, 5]);
  assert.equal(tree[0].children[0].children[0].children[0].name, "Soldável");
  assert.equal(flattenCategoryTree(tree).length, 5);
});

test("categorias ocultas e pais ausentes não quebram o Header", () => {
  const tree = buildCategoryTree([
    category(1, "Sem categoria", "uncategorized"),
    category(2, "Órfã", "orfa", 999),
  ]);
  assert.deepEqual(tree.map(({ slug }) => slug), ["orfa"]);
});

test("Header não contém categorias comerciais fixas", async () => {
  const [header, mobile] = await Promise.all([
    readFile(new URL("../components/Header/Header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Header/MobileMenu.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(header, /const menuItems/);
  assert.doesNotMatch(mobile, /const categories/);
  assert.match(header, /<MegaMenu \/>/);
  assert.match(mobile, /<MegaMenuMobile/);
});
