import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBreadcrumbListJsonLd,
  buildProductCategoryBreadcrumb,
} from "../lib/seo/productBreadcrumb.ts";
import { getCircularAdjacentItems } from "../lib/commerce/adjacentProducts.ts";

const category = (id, name, slug, parent = 0) => ({
  id,
  name,
  slug,
  parent,
});
const labels = (items) => items.map((item) => item.label);
const build = (overrides = {}) =>
  buildProductCategoryBreadcrumb({
    productName: "Produto",
    productCategoryIds: [],
    categories: [],
    ...overrides,
  });

test("produto sem categoria", () => {
  assert.deepEqual(labels(build()), ["Home", "Produto"]);
});

test("uma categoria raiz", () => {
  assert.deepEqual(
    labels(build({
      productCategoryIds: [1],
      categories: [category(1, "Hidráulica", "hidraulica")],
    })),
    ["Home", "Hidráulica", "Produto"],
  );
});

test("categoria com um pai", () => {
  assert.deepEqual(
    labels(build({
      productCategoryIds: [2],
      categories: [
        category(1, "Hidráulica", "hidraulica"),
        category(2, "Tubos", "tubos", 1),
      ],
    })),
    ["Home", "Hidráulica", "Tubos", "Produto"],
  );
});

test("quatro níveis usam parents reais e ignoram a ordem recebida", () => {
  const categories = [
    category(4, "Tubo Marrom", "tubo-marrom", 3),
    category(2, "Tubos e Conexões", "tubos-e-conexoes", 1),
    category(1, "Hidráulica", "hidraulica"),
    category(3, "Água Fria", "agua-fria", 2),
  ];
  assert.deepEqual(
    labels(build({
      productName: "Tubo 60 mm",
      productCategoryIds: [3, 1, 4, 2],
      categories,
    })),
    [
      "Home",
      "Hidráulica",
      "Tubos e Conexões",
      "Água Fria",
      "Tubo Marrom",
      "Tubo 60 mm",
    ],
  );
});

test("categorias paralelas não são misturadas", () => {
  assert.deepEqual(
    labels(build({
      productCategoryIds: [3, 2],
      categories: [
        category(1, "Raiz A", "raiz-a"),
        category(2, "Filha A", "filha-a", 1),
        category(3, "Raiz B", "raiz-b"),
      ],
    })),
    ["Home", "Raiz A", "Filha A", "Produto"],
  );
});

test("categoria mais profunda é escolhida", () => {
  assert.deepEqual(
    labels(build({
      productCategoryIds: [1, 3],
      categories: [
        category(1, "Raiz", "raiz"),
        category(2, "Meio", "meio", 1),
        category(3, "Folha", "folha", 2),
      ],
    })),
    ["Home", "Raiz", "Meio", "Folha", "Produto"],
  );
});

test("empate de profundidade tem resultado determinístico", () => {
  const options = {
    productCategoryIds: [20, 10],
    categories: [
      category(20, "Vinte", "vinte"),
      category(10, "Dez", "dez"),
    ],
  };
  assert.deepEqual(labels(build(options)), ["Home", "Dez", "Produto"]);
  assert.deepEqual(labels(build(options)), ["Home", "Dez", "Produto"]);
});

test("categoria principal explícita tem prioridade", () => {
  assert.deepEqual(
    labels(build({
      productCategoryIds: [2, 3],
      categories: [
        category(1, "Raiz", "raiz"),
        category(2, "Profunda", "profunda", 1),
        category(3, "Escolhida", "escolhida"),
      ],
      explicitPrimaryCategoryId: 3,
    })),
    ["Home", "Escolhida", "Produto"],
  );
});

test("parent inexistente preserva o trecho disponível", () => {
  assert.deepEqual(
    labels(build({
      productCategoryIds: [2],
      categories: [category(2, "Órfã", "orfa", 99)],
    })),
    ["Home", "Órfã", "Produto"],
  );
});

test("loop de parent é interrompido", () => {
  assert.deepEqual(
    labels(build({
      productCategoryIds: [1],
      categories: [
        category(1, "Um", "um", 2),
        category(2, "Dois", "dois", 1),
      ],
    })),
    ["Home", "Dois", "Um", "Produto"],
  );
});

test("categoria duplicada aparece uma vez", () => {
  const duplicate = category(1, "Hidráulica", "hidraulica");
  assert.deepEqual(
    labels(build({
      productCategoryIds: [1, 1],
      categories: [duplicate, duplicate],
    })),
    ["Home", "Hidráulica", "Produto"],
  );
});

test("endpoint indisponível usa Home e produto", () => {
  assert.deepEqual(
    labels(build({ productCategoryIds: [10], categories: [] })),
    ["Home", "Produto"],
  );
});

test("produto variável usa a hierarquia do produto pai", () => {
  assert.deepEqual(
    labels(build({
      productName: "Produto variável",
      productCategoryIds: [2],
      categories: [
        category(1, "Raiz", "raiz"),
        category(2, "Variações", "variacoes", 1),
      ],
    })),
    ["Home", "Raiz", "Variações", "Produto variável"],
  );
});

test("categoria com acento mantém label e URL existente", () => {
  const result = build({
    productCategoryIds: [1],
    categories: [category(1, "Água Fria", "agua-fria")],
  });
  assert.equal(result[1].label, "Água Fria");
  assert.equal(result[1].href, "/categoria/agua-fria");
});

test("breadcrumb visual marca somente o produto como atual", () => {
  assert.deepEqual(
    build({
      productCategoryIds: [1],
      categories: [category(1, "Categoria", "categoria")],
    }),
    [
      { label: "Home", href: "/" },
      { label: "Categoria", href: "/categoria/categoria" },
      { label: "Produto", current: true },
    ],
  );
});

test("BreadcrumbList JSON-LD possui a mesma ordem visual", () => {
  const visual = build({
    productCategoryIds: [2],
    categories: [
      category(1, "Hidráulica", "hidraulica"),
      category(2, "Água Fria", "agua-fria", 1),
    ],
  });
  const jsonLd = buildBreadcrumbListJsonLd(
    visual,
    "https://persimateriais.com.br",
    "/produto/produto",
  );
  assert.deepEqual(
    jsonLd.itemListElement.map(({ position, name }) => ({ position, name })),
    [
      { position: 1, name: "Home" },
      { position: 2, name: "Hidráulica" },
      { position: 3, name: "Água Fria" },
      { position: 4, name: "Produto" },
    ],
  );
  assert.equal(
    jsonLd.itemListElement.at(-1).item,
    "https://persimateriais.com.br/produto/produto",
  );
});

test("navegação circular conecta primeiro e último produto", () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(getCircularAdjacentItems(items, 1), {
    previous: items[2],
    next: items[1],
  });
  assert.deepEqual(getCircularAdjacentItems(items, 3), {
    previous: items[1],
    next: items[0],
  });
});

test("dois produtos apontam para o mesmo vizinho válido", () => {
  const items = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(getCircularAdjacentItems(items, 1), {
    previous: items[1],
    next: items[1],
  });
});

test("um único produto oculta a navegação", () => {
  assert.equal(getCircularAdjacentItems([{ id: 1 }], 1), undefined);
});

test("produto ausente da sequência oculta a navegação", () => {
  assert.equal(
    getCircularAdjacentItems([{ id: 1 }, { id: 2 }], 3),
    undefined,
  );
});
