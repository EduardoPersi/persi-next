// PIM publication feature mode -- deliberately SEPARATE from
// lib/catalog/flags.ts's CatalogDataSource/canaryPercent. That system
// decides whether the WHOLE product read (price/title/images/everything)
// comes from WooCommerce or Postgres, using a percentage cohort bucket
// (lib/catalog/routerCore.ts). This one governs only whether PIM attribute
// PUBLICATIONS (pim_attribute_publications) are computed/exposed at all,
// independent of which system serves the rest of the product -- a product
// can be on the Postgres catalog cohort with zero published PIM attributes,
// or on the WooCommerce cohort while still being part of a PIM attribute
// canary. Mixing the two into one flag would make it impossible to reason
// about either rollout independently.
export type PimPublicationMode = "off" | "shadow" | "canary";

export interface PimPublicationFlags {
  mode: PimPublicationMode;
  /** 0-100. Deterministic sampling rate for the A3.6-B runtime shadow
   * observation (see lib/pim/publication-shadow-runtime.ts). Deliberately
   * its own env var (PIM_SHADOW_SAMPLE_RATE), not
   * CATALOG_SHADOW_SAMPLE_RATE (lib/catalog/flags.ts) -- same reasoning as
   * PimPublicationMode vs CatalogDataSource above: this samples PIM
   * attribute-publication shadow comparisons specifically, independent of
   * the whole-catalog Woo-vs-Postgres shadow's own sampling. Defaults to 0
   * (no sampling at all) even when mode='shadow', so enabling the mode
   * alone never turns on any real comparison volume by accident -- both
   * knobs must be turned deliberately. Not set in any real environment as
   * of A3.6-B. */
  shadowSampleRatePercent: number;
}

export function getPimPublicationFlags(environment: NodeJS.ProcessEnv = process.env): PimPublicationFlags {
  const raw = environment.PIM_PUBLICATION_MODE;
  const mode: PimPublicationMode = raw === "shadow" || raw === "canary" ? raw : "off";
  const rawRate = Number(environment.PIM_SHADOW_SAMPLE_RATE ?? "0");
  const shadowSampleRatePercent = Number.isFinite(rawRate) ? Math.min(100, Math.max(0, rawRate)) : 0;
  return { mode, shadowSampleRatePercent };
}

// off: no publication read model is consulted; storefront behavior is
//   unchanged from today (attributes.status='active' shadow gate only).
// shadow: getPublishedProductAttributes() may be called and its result
//   compared/logged (mirroring lib/catalog/shadowCore.ts's pattern), but
//   the value returned to the user must never depend on it.
// canary: for a product with an active canary membership
//   (getActiveCanaryMembership), the published PIM attributes MAY be merged
//   into what the user sees, per the merge policy in
//   docs/pim/10-publication-architecture.md. This mode is not wired to any
//   route in A3.5E-P3-A -- it exists so the next phase does not have to
//   invent the mode enum under time pressure.
