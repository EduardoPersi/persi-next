export const SYNTHETIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createSyntheticSlug(label, suffix) {
  const normalizedLabel = String(label)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const normalizedSuffix = String(suffix)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^-+|-+$/g, "");
  if (!normalizedLabel || !normalizedSuffix) throw new Error("SYNTHETIC_SLUG_INPUT_INVALID");
  const slug = `${normalizedLabel}-${normalizedSuffix}`;
  if (!SYNTHETIC_SLUG_PATTERN.test(slug)) throw new Error("SYNTHETIC_SLUG_INVALID");
  return slug;
}
