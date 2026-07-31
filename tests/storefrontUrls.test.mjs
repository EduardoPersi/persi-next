import assert from "node:assert/strict";
import test from "node:test";
import {
  findCategoryByPath,
  getCategoryHref,
  getProductHref,
  RESERVED_ROOT_SLUGS,
  SITE_URL,
} from "../lib/routing/storefrontUrls.ts";

const categories = [
  { id: 1, name: "Hidráulica", slug: "hidraulica", parent: 0 },
  {
    id: 2,
    name: "Tratamento de água",
    slug: "tratamento-de-agua",
    parent: 1,
  },
];

test("produto fica diretamente na raiz", () => {
  assert.equal(getProductHref("produto-exemplo"), "/produto-exemplo");
});

test("categoria preserva toda a hierarquia", () => {
  assert.equal(getCategoryHref(categories[0], categories), "/hidraulica");
  assert.equal(
    getCategoryHref(categories[1], categories),
    "/hidraulica/tratamento-de-agua",
  );
});

test("categoria só resolve pela cadeia canônica completa", () => {
  assert.equal(
    findCategoryByPath(
      ["hidraulica", "tratamento-de-agua"],
      categories,
    )?.id,
    2,
  );
  assert.equal(
    findCategoryByPath(["tratamento-de-agua"], categories),
    undefined,
  );
});

test("rotas funcionais e institucionais são reservadas", () => {
  assert.equal(SITE_URL, "https://persimateriais.com.br");
  assert.equal(RESERVED_ROOT_SLUGS.has("checkout"), true);
  assert.equal(RESERVED_ROOT_SLUGS.has("contato"), true);
});
