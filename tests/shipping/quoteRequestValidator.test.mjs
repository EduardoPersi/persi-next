import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHasQuotableItems,
  resolveQuoteItems,
  shippingQuoteRequestSchema,
} from "../../lib/shipping/validators/quoteRequest.ts";
import { ShippingValidationError } from "../../lib/shipping/core/errors.ts";

const VARIANT_OK = "11111111-1111-1111-1111-111111111111";
const VARIANT_NO_DIMENSIONS = "22222222-2222-2222-2222-222222222222";
const VARIANT_UNKNOWN_UNIT = "33333333-3333-3333-3333-333333333333";
const VARIANT_INACTIVE = "44444444-4444-4444-4444-444444444444";

function makeRepository({ variants, prices }) {
  return {
    async findVariants(ids) {
      return variants.filter((variant) => ids.includes(variant.id));
    },
    async findActivePrices(ids) {
      return prices.filter((price) => ids.includes(price.variantId));
    },
  };
}

test("CEP inválido é rejeitado pelo schema, não chega à resolução de itens", () => {
  const result = shippingQuoteRequestSchema.safeParse({
    postcode: "123",
    items: [{ variantId: VARIANT_OK, quantity: 1 }],
  });
  assert.equal(result.success, false);
});

test("payload com peso/preço enviados pelo cliente é rejeitado (schema .strict())", () => {
  const result = shippingQuoteRequestSchema.safeParse({
    postcode: "13214065",
    items: [
      { variantId: VARIANT_OK, quantity: 1, weightKg: 999, insuranceValueMinor: 1 },
    ],
  });
  assert.equal(result.success, false, "campos extras (peso/preço) devem ser rejeitados, não ignorados silenciosamente");
});

test("produto sem peso/dimensão vira warning explícito, nunca fallback silencioso 15x15x15/1kg", async () => {
  const repository = makeRepository({
    variants: [
      { id: VARIANT_NO_DIMENSIONS, status: "active", weightValue: null, weightUnitCode: null, widthValue: null, heightValue: null, lengthValue: null, dimensionUnitCode: null },
    ],
    prices: [{ variantId: VARIANT_NO_DIMENSIONS, listAmountMinor: 1000n, saleAmountMinor: null }],
  });

  const result = await resolveQuoteItems(repository, [{ variantId: VARIANT_NO_DIMENSIONS, quantity: 1 }]);

  assert.equal(result.items.length, 0, "item sem dimensão não deve ser incluído no pacote");
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "MISSING_DIMENSIONS");
  assert.equal(result.warnings[0].variantId, VARIANT_NO_DIMENSIONS);

  assert.throws(() => assertHasQuotableItems(result), ShippingValidationError);
});

test("unidade de medida desconhecida também bloqueia o item (não assume kg/cm por padrão)", async () => {
  const repository = makeRepository({
    variants: [
      {
        id: VARIANT_UNKNOWN_UNIT, status: "active",
        weightValue: "1.5", weightUnitCode: "lb",
        widthValue: "10", heightValue: "10", lengthValue: "10", dimensionUnitCode: "in",
      },
    ],
    prices: [{ variantId: VARIANT_UNKNOWN_UNIT, listAmountMinor: 5000n, saleAmountMinor: null }],
  });

  const result = await resolveQuoteItems(repository, [{ variantId: VARIANT_UNKNOWN_UNIT, quantity: 1 }]);

  assert.equal(result.items.length, 0);
  assert.equal(result.warnings[0].code, "MISSING_DIMENSIONS");
});

test("variante inativa ou inexistente é excluída, não derruba o restante do carrinho", async () => {
  const repository = makeRepository({
    variants: [
      { id: VARIANT_OK, status: "active", weightValue: "1.2", weightUnitCode: "kg", widthValue: "20", heightValue: "10", lengthValue: "15", dimensionUnitCode: "cm" },
      { id: VARIANT_INACTIVE, status: "inactive", weightValue: "1", weightUnitCode: "kg", widthValue: "10", heightValue: "10", lengthValue: "10", dimensionUnitCode: "cm" },
    ],
    prices: [
      { variantId: VARIANT_OK, listAmountMinor: 12990n, saleAmountMinor: null },
      { variantId: VARIANT_INACTIVE, listAmountMinor: 5000n, saleAmountMinor: null },
    ],
  });

  const result = await resolveQuoteItems(repository, [
    { variantId: VARIANT_OK, quantity: 2 },
    { variantId: VARIANT_INACTIVE, quantity: 1 },
  ]);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].variantId, VARIANT_OK);
  assert.equal(result.warnings.length, 1);
  assert.doesNotThrow(() => assertHasQuotableItems(result));
});

test("peso/dimensão/preço do item resolvido vêm sempre do repositório (Supabase), com conversão de unidade correta", async () => {
  const repository = makeRepository({
    variants: [
      {
        id: VARIANT_OK, status: "active",
        weightValue: "1500", weightUnitCode: "g",
        widthValue: "1", heightValue: "0.5", lengthValue: "0.3", dimensionUnitCode: "m",
      },
    ],
    prices: [{ variantId: VARIANT_OK, listAmountMinor: 20000n, saleAmountMinor: 18990n }],
  });

  const result = await resolveQuoteItems(repository, [{ variantId: VARIANT_OK, quantity: 3 }]);

  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.quantity, 3);
  assert.equal(item.weightKg, 1.5, "1500g deve virar 1.5kg");
  assert.equal(item.widthCm, 100, "1m deve virar 100cm");
  assert.equal(item.heightCm, 50);
  assert.equal(item.lengthCm, 30);
  assert.equal(item.insuranceValueMinor, 18990, "preço promocional (sale) deve prevalecer sobre o preço de lista");
});

test("sem nenhum item cotável, assertHasQuotableItems lança erro explícito com os motivos", async () => {
  const repository = makeRepository({ variants: [], prices: [] });
  const result = await resolveQuoteItems(repository, [{ variantId: VARIANT_NO_DIMENSIONS, quantity: 1 }]);
  assert.throws(() => assertHasQuotableItems(result), (error) => {
    assert.ok(error instanceof ShippingValidationError);
    assert.equal(error.issues.length, 1);
    return true;
  });
});
