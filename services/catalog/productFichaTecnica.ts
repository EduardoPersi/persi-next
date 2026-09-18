import "server-only";

import type { Product, ProductSpecification } from "@/types/product";
import { getPimPublicationFlags } from "@/lib/pim/publication-flags";
import { isPimShadowSafeToRun } from "@/lib/pim/publication-runtime-preflight";
import { defaultResolvePimProductId } from "@/lib/pim/publication-shadow-runtime";
import { getActiveCanaryMembership, getPublishedAttributesForProduct, type PublishedAttributeRecord } from "@/lib/pim/publication-read-model";
import { evaluatePublicationEligibilityBatch } from "@/lib/pim/publication-eligibility";
import { getDatabase } from "@/lib/db";
import { buildPimCatalogCandidate } from "@/lib/pim/publication-candidate";
import { buildFichaTecnicaSpecifications } from "@/lib/pim/publication-ficha-tecnica";
import { mapWooProductToCatalog } from "./woocommerce";

// A3.7-A-R15: the ONLY integration point where a PIM-published attribute
// may reach the public Ficha Técnica -- mirrors services/catalog/
// productShadow.ts's own architecture (mode-check-first, fail-closed
// try/catch, timeout-bounded) but is AWAITED (unlike the shadow, which is
// fire-and-forget), because its result actually affects what is rendered.
// Must be called from exactly ONE place: app/_storefront/product-page.tsx,
// for the route's own main product -- never from getProductBySlug (shared
// with incidental lookups, per the A3.7-A-R14-R1/R14-R2 lesson), never
// from productNavigation.ts, never from any listing/search/category path.

const DEFAULT_TIMEOUT_MS = 300;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PIM_FICHA_TECNICA_TIMEOUT")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export interface FichaTecnicaDependencies {
  mode?: ReturnType<typeof getPimPublicationFlags>["mode"];
  timeoutMs?: number;
  isSafeToRun?: () => boolean;
  resolvePimProductId?: (slug: string) => Promise<string | null>;
  getActiveCanaryMembership?: typeof getActiveCanaryMembership;
  getPublishedAttributesForProduct?: typeof getPublishedAttributesForProduct;
  evaluatePublicationEligibilityBatch?: typeof evaluatePublicationEligibilityBatch;
}

/**
 * Resolves the final Ficha Técnica specification list for the route's main
 * PDP product, or `undefined` when nothing should be added (any mode other
 * than "canary", the product has no active canary membership, every
 * candidate attribute fails a FRESH eligibility re-check, or any error/
 * timeout occurs). `undefined` means "render Woo-only, exactly as today" --
 * the caller must never treat it as an error to surface.
 */
export async function resolveFichaTecnicaSpecifications(product: Product, deps: FichaTecnicaDependencies = {}): Promise<ProductSpecification[] | undefined> {
  const mode = deps.mode ?? getPimPublicationFlags().mode;
  // off AND shadow both stop here, before any DB access -- identical to
  // today's behavior in both modes. Only "canary" proceeds.
  if (mode !== "canary") return undefined;

  const isSafeToRun = deps.isSafeToRun ?? isPimShadowSafeToRun;
  if (!isSafeToRun()) return undefined;

  const resolvePimProductId = deps.resolvePimProductId ?? defaultResolvePimProductId;
  const membershipFn = deps.getActiveCanaryMembership ?? getActiveCanaryMembership;
  const publishedFn = deps.getPublishedAttributesForProduct ?? getPublishedAttributesForProduct;
  const eligibilityBatchFn = deps.evaluatePublicationEligibilityBatch ?? evaluatePublicationEligibilityBatch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    return await withTimeout(
      (async () => {
        const pimProductId = await resolvePimProductId(product.slug);
        if (!pimProductId) return undefined;

        // Canary allowlist FIRST (cheapest possible short-circuit): a
        // product with zero active-canary-batch membership rows behaves
        // exactly like mode=shadow -- Woo-only, unconditionally. This is
        // the REAL, non-hardcoded allowlist (lib/pim/publication-read-model.ts's
        // getActiveCanaryMembership, already existing, already tested,
        // never wired to any route before this round).
        const membership = await membershipFn(pimProductId);
        if (membership.length === 0) return undefined;

        const canaryCodes = new Set(membership.map((m) => m.attributeCode));
        const published = await publishedFn(pimProductId);
        // getPublishedAttributesForProduct already enforces
        // isPublicationExposable (published + active batch + source PAV
        // still matches + attribute/value still resolve) -- intersecting
        // with the canary allowlist means a row must pass BOTH checks.
        const canaryPublished = published.filter((record) => canaryCodes.has(record.attributeSlug));
        if (canaryPublished.length === 0) return undefined;

        // A3.7-A-R14-R5's residual-risk finding: a review can be recorded
        // AFTER an attribute is published, without automatically
        // unpublishing it. Re-run the REAL eligibility gate, fresh, right
        // now -- never trust the historical publish-time decision alone
        // for something as high-stakes as live public exposure (shadow
        // telemetry tolerates this staleness; public rendering must not).
        const db = getDatabase();
        const eligibility = await eligibilityBatchFn(
          db,
          canaryPublished.map((record) => ({ productId: record.productId, attributeId: record.attributeId, attributeValueId: record.attributeValueId })),
        );
        const stillEligible: PublishedAttributeRecord[] = canaryPublished.filter((record) => {
          const key = `${record.productId}:${record.attributeId}:${record.attributeValueId}`;
          return eligibility.get(key)?.eligible === true;
        });
        if (stillEligible.length === 0) return undefined;

        const official = mapWooProductToCatalog(product);
        const candidate = buildPimCatalogCandidate(pimProductId, stillEligible);
        const { specifications } = buildFichaTecnicaSpecifications(official, candidate);
        return specifications;
      })(),
      timeoutMs,
    );
  } catch {
    // Fail-closed: ANY error (DB, timeout, mapping) falls back to
    // undefined -- today's exact Woo-only rendering, never a partial or
    // broken Ficha Técnica.
    return undefined;
  }
}
