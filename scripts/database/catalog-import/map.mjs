import { moneyToMinor, normalizeSku, resolveGtin } from "./normalize.mjs";
import { mapWooSalePeriod } from "./sync.mjs";

export function mapSellableItems(product, variations = [], options = {}) {
  const source = product.type === "variable" ? variations : [product];
  return source.map((entity) => {
    const sku = normalizeSku(entity.sku);
    const gtin = resolveGtin(entity, options);
    return {
      externalId: String(entity.id),
      parentExternalId: String(product.id),
      sku: sku.original,
      skuNormalized: sku.normalized,
      skuValid: sku.valid,
      gtin: gtin.value,
      gtinStatus: gtin.status,
      regularAmountMinor: moneyToMinor(entity.regular_price),
      saleAmountMinor: moneyToMinor(entity.sale_price),
      rawRegularPrice: String(entity.regular_price ?? ""),
      rawSalePrice: String(entity.sale_price ?? ""),
      salePeriod: mapWooSalePeriod(entity),
      stockQuantity: entity.manage_stock && Number.isFinite(Number(entity.stock_quantity)) ? BigInt(Math.max(0, Number(entity.stock_quantity))) : 0n,
      stockStatus: entity.stock_status,
      attributes: entity.attributes ?? [],
      image: entity.image ?? null,
      weight: entity.weight || null,
      dimensions: entity.dimensions ?? null,
    };
  });
}

export function validateMappedItems(product, items) {
  const conflicts = [];
  if (product.type === "variable" && items.length !== (product.variations?.length ?? items.length)) conflicts.push({ code: "VARIATION_COUNT_MISMATCH" });
  for (const item of items) {
    if (!item.skuValid) conflicts.push({ code: "VARIATION_SKU_MISSING", externalId: item.externalId });
    if (item.regularAmountMinor === undefined || item.saleAmountMinor === undefined) conflicts.push({ code: "PRICE_INVALID", externalId: item.externalId });
  }
  const skus = items.filter((item) => item.skuValid).map((item) => item.skuNormalized);
  if (new Set(skus).size !== skus.length) conflicts.push({ code: "VARIATION_SKU_DUPLICATE" });
  return conflicts;
}
