import sanitizeHtml from "sanitize-html";
import { decimalToMinor } from "./commercial-policy.mjs";

export const ATTRIBUTE_RULES = new Map([
  ["marca", { code: "marca", entity: "brand", source: "local_exact" }],
  ["cor", { code: "cor", source: "local_exact" }],
  ["pa_bitola", { code: "bitola", dimension: "length" }],
  ["pa_bitola-em-milimetros", { code: "bitola_mm", dimension: "length" }],
  ["pa_corrente", { code: "corrente_nominal", dimension: "current" }],
  ["pa_potencia", { code: "potencia", dimension: "power" }],
  ["pa_tensao", { code: "tensao", dimension: "voltage" }],
  ["pa_cor", { code: "cor" }],
  ["pa_fase", { code: "fase" }],
  ["pa_polos", { code: "numero_polos" }],
  ["pa_peso", { code: "embalagem" }],
  ["pa_tamanho", { code: "tamanho" }],
  ["pa_tipo-de-perfil", { code: "tipo_perfil" }],
  ["pa_marca", { code: "marca", entity: "brand" }],
]);

export function normalizeSku(value) {
  const original = String(value ?? "").trim();
  return { original, normalized: original.toUpperCase(), valid: original.length > 0 && original.length <= 100 };
}

export function normalizeGtin(value) {
  const gtin = String(value ?? "").trim();
  if (!gtin) return { value: null, status: "missing" };
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return { value: null, status: "invalid_format", raw: gtin };
  let sum = 0;
  for (let index = gtin.length - 2, position = 0; index >= 0; index -= 1, position += 1) sum += Number(gtin[index]) * (position % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(gtin.at(-1)) ? { value: gtin, status: "valid" } : { value: null, status: "invalid_checksum", raw: gtin };
}

export function resolveGtin(entity, { duplicateGtins = new Set() } = {}) {
  const native = normalizeGtin(entity.global_unique_id);
  const legacyEntry = (entity.meta_data ?? []).find((entry) => entry.key === "hwp_product_gtin");
  const legacy = normalizeGtin(legacyEntry?.value);
  const selected = native.value ?? legacy.value;
  if (selected && duplicateGtins.has(selected)) return { value: null, status: "duplicate_unresolved", candidates: [selected], authority: native.value ? "global_unique_id" : "legacy" };
  if (native.value && legacy.value && native.value !== legacy.value) return { value: native.value, status: "resolved_native_precedence", candidates: [native.value, legacy.value], authority: "global_unique_id" };
  return native.value ? native : legacy;
}

export function moneyToMinor(value) {
  return decimalToMinor(value, "half_up");
}

export function normalizeBrandName(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function slugify(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function sanitizeDescription(value) {
  return sanitizeHtml(String(value ?? ""), { allowedTags: ["p", "br", "ul", "ol", "li", "strong", "em", "b", "i", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "a"], allowedAttributes: { a: ["href", "title", "target", "rel"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] }, allowedSchemes: ["http", "https", "mailto"] }).trim() || null;
}

function rational(raw) {
  const value = raw.trim();
  const mixed = value.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return { numerator: BigInt(mixed[1]) * BigInt(mixed[3]) + BigInt(mixed[2]), denominator: BigInt(mixed[3]) };
  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return { numerator: BigInt(fraction[1]), denominator: BigInt(fraction[2]) };
  const decimal = value.replace(",", ".").match(/^(\d+)(?:\.(\d+))?$/);
  if (!decimal) return null;
  const denominator = 10n ** BigInt((decimal[2] ?? "").length);
  return { numerator: BigInt(decimal[1]) * denominator + BigInt(decimal[2] ?? 0), denominator };
}

export function parseCompositeMeasurement(raw) {
  const display = String(raw ?? "").trim().replace(/×/g, "x");
  const parts = display.split(/\s*x\s*/i);
  if (parts.length < 2 || parts.length > 3) return null;
  const explicitUnits = parts.map((part) => /(?:"|”|\bpol)/i.test(part) ? "in" : /mm/i.test(part) ? "mm" : null);
  if (explicitUnits.some((unit) => unit === null)) return null;
  const components = parts.map((part, index) => {
    const unit = explicitUnits[index];
    const numeric = part.replace(/(?:mm|"|”|pol(?:egadas?)?)/gi, "").trim();
    const value = rational(numeric);
    return value && { ...value, unit, position: index + 1, semanticRole: index === 0 ? "dimension_a" : index === 1 ? "dimension_b" : "dimension_c", displayValue: part.trim() };
  });
  if (components.some((component) => !component)) return null;
  return { displayValue: display, normalizedText: components.map((component) => `${component.numerator}/${component.denominator} ${component.unit}`).join(" x "), components };
}

export function preserveAmbiguousMeasurement(raw) {
  const displayValue = String(raw ?? "").trim().replace(/×/g, "x");
  if (!/\s*x\s*/i.test(displayValue) || parseCompositeMeasurement(displayValue)) return null;
  return { displayValue, normalizedText: displayValue.normalize("NFKC").replace(/\s+/g, " ").replace(/\s*x\s*/gi, " x "), status: "ambiguous", components: [] };
}

export function normalizeStatus(status, dateCreatedGmt = null) {
  if (status !== "publish") return { status: status === "trash" ? "archived" : "draft", publishedAt: null };
  const instant = dateCreatedGmt ? new Date(`${String(dateCreatedGmt).replace(/Z$/i, "")}Z`) : null;
  if (!instant || Number.isNaN(instant.valueOf())) throw new Error("PUBLISHED_AT_GMT_MISSING");
  return { status: "active", publishedAt: instant.toISOString() };
}
