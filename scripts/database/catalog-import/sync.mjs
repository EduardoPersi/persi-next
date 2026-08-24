export function normalizeWooDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function mapWooSalePeriod(entity) {
  const fromGmt = entity.date_on_sale_from_gmt;
  const toGmt = entity.date_on_sale_to_gmt;
  return {
    from: normalizeWooDate(fromGmt ? `${fromGmt}Z` : null),
    to: normalizeWooDate(toGmt ? `${toGmt}Z` : null),
    source: fromGmt || toGmt ? "gmt" : "undated",
  };
}

export function planSetSync(current, desired, keyOf = (value) => value) {
  const currentByKey = new Map(current.map((value) => [keyOf(value), value]));
  const desiredByKey = new Map(desired.map((value) => [keyOf(value), value]));
  return {
    add: desired.filter((value) => !currentByKey.has(keyOf(value))),
    remove: current.filter((value) => !desiredByKey.has(keyOf(value))),
    keep: desired.filter((value) => currentByKey.has(keyOf(value))),
  };
}

export function createWriteMetrics() {
  return { insert: 0, update: 0, delete: 0, noop: 0, byEntity: {} };
}

export function recordWrite(metrics, entity, operation, count = 1) {
  metrics[operation] += count;
  metrics.byEntity[entity] ??= { insert: 0, update: 0, delete: 0, noop: 0 };
  metrics.byEntity[entity][operation] += count;
}
