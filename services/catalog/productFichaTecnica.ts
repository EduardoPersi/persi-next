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
import { classifyRawPimModeForDiagnostics, getRawPimPublicationModeForDiagnostics, type FichaTecnicaDiagnosticEvent, type FichaTecnicaDiagnosticReason, type FichaTecnicaStageTimings } from "@/lib/pim/publication-ficha-tecnica-diagnostics";
import { emitFichaTecnicaDiagnostic, getConfiguredFichaTecnicaTelemetrySink, isFichaTecnicaDiagnosticsEnabled, type FichaTecnicaTelemetrySink } from "@/lib/pim/publication-ficha-tecnica-telemetry";

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
  /** A3.7-A-R17-R2A diagnostics -- every field below is purely observational
   * and injectable ONLY so tests can assert on it without real env/process
   * access; none of them can change what this function returns publicly. */
  rawMode?: string | undefined;
  telemetry?: FichaTecnicaTelemetrySink;
  diagnosticsEnabled?: boolean;
}

/** A3.7-A-R17-R2A: internal shape carrying BOTH the public result and the
 * diagnostic counters, so the outer function can emit exactly one telemetry
 * event without duplicating any of the gate logic below. Never exported --
 * the public function's return type is unchanged. */
interface FichaTecnicaRun {
  specifications: ProductSpecification[] | undefined;
  productResolved: boolean;
  membershipCount: number | null;
  publishedCount: number | null;
  intersectionCount: number | null;
  eligibleCount: number | null;
  mergeAdditionCount: number | null;
  reason: FichaTecnicaDiagnosticReason;
}

const SKIPPED: Omit<FichaTecnicaRun, "reason"> = {
  specifications: undefined,
  productResolved: false,
  membershipCount: null,
  publishedCount: null,
  intersectionCount: null,
  eligibleCount: null,
  mergeAdditionCount: null,
};

/**
 * Resolves the final Ficha Técnica specification list for the route's main
 * PDP product, or `undefined` when nothing should be added (any mode other
 * than "canary", the product has no active canary membership, every
 * candidate attribute fails a FRESH eligibility re-check, or any error/
 * timeout occurs). `undefined` means "render Woo-only, exactly as today" --
 * the caller must never treat it as an error to surface.
 *
 * A3.7-A-R17-R2A: also emits exactly one [pim-ficha-tecnica-canary]
 * diagnostic event per call (never per PDP indirectly -- this function
 * itself is only ever called once per PDP, from product-page.tsx), gated
 * on PERSI_RUNTIME_ENV=staging and the existing PIM_SHADOW_TELEMETRY_SINK
 * switch. The event is purely observational: it can never change the value
 * returned here.
 */
export async function resolveFichaTecnicaSpecifications(product: Product, deps: FichaTecnicaDependencies = {}): Promise<ProductSpecification[] | undefined> {
  const startedAt = performance.now();
  const mode = deps.mode ?? getPimPublicationFlags().mode;
  // Diagnostics are computed unconditionally (pure, zero I/O) so Gate 0
  // itself is provable even when mode="off" -- but nothing below this line
  // executes any query unless mode is genuinely "canary", so "off" (and
  // "shadow") remain exactly as cheap as before this round.
  const rawMode = deps.rawMode ?? getRawPimPublicationModeForDiagnostics();
  const modeRawClass = classifyRawPimModeForDiagnostics(rawMode);

  // A3.7-A-R17-R2A-D6: a mutable, shared timing record -- updated IN PLACE
  // by runFichaTecnicaPipeline as each stage actually completes. Passed by
  // reference (not returned) specifically so a TIMEOUT still leaves behind
  // whichever stage timings DID complete before the clock ran out; the
  // pipeline's own return value alone cannot carry that information on the
  // timeout path, since withTimeout abandons (does not cancel) the inner
  // work and the outer race settles on the timer, not on the pipeline.
  const timings: FichaTecnicaStageTimings = {
    productResolutionMs: null,
    membershipMs: null,
    publicationReadMs: null,
    eligibilityMs: null,
    mergeMs: null,
  };

  const run = await runFichaTecnicaPipeline(product, mode, deps, timings);

  const event: FichaTecnicaDiagnosticEvent = {
    resolvedMode: mode,
    modeRawClass,
    productResolved: run.productResolved,
    membershipCount: run.membershipCount,
    publishedCount: run.publishedCount,
    intersectionCount: run.intersectionCount,
    eligibleCount: run.eligibleCount,
    mergeAdditionCount: run.mergeAdditionCount,
    result: run.reason === "SUCCESS" ? "SUCCESS" : run.reason === "TIMEOUT" || run.reason === "ERROR" ? "ERROR" : "SKIPPED",
    reason: run.reason,
    durationMs: performance.now() - startedAt,
    ...timings,
  };
  const diagnosticsEnabled = deps.diagnosticsEnabled ?? isFichaTecnicaDiagnosticsEnabled();
  if (diagnosticsEnabled) {
    const telemetry = deps.telemetry ?? getConfiguredFichaTecnicaTelemetrySink();
    emitFichaTecnicaDiagnostic(telemetry, event);
  }

  return run.specifications;
}

/** Does the REAL work -- identical decisions/order to the pre-R17-R2A
 * implementation, just also returning the diagnostic counters alongside
 * the public result. Every early return here is BEHAVIORALLY unchanged:
 * still resolves to `specifications: undefined` in exactly the same
 * conditions as before. */
async function runFichaTecnicaPipeline(product: Product, mode: ReturnType<typeof getPimPublicationFlags>["mode"], deps: FichaTecnicaDependencies, timings: FichaTecnicaStageTimings): Promise<FichaTecnicaRun> {
  // off AND shadow both stop here, before any DB access -- identical to
  // today's behavior in both modes. Only "canary" proceeds.
  if (mode !== "canary") return { ...SKIPPED, reason: "MODE_NOT_CANARY" };

  const isSafeToRun = deps.isSafeToRun ?? isPimShadowSafeToRun;
  if (!isSafeToRun()) return { ...SKIPPED, reason: "UNSAFE_DB_BINDING" };

  const resolvePimProductId = deps.resolvePimProductId ?? defaultResolvePimProductId;
  const membershipFn = deps.getActiveCanaryMembership ?? getActiveCanaryMembership;
  const publishedFn = deps.getPublishedAttributesForProduct ?? getPublishedAttributesForProduct;
  const eligibilityBatchFn = deps.evaluatePublicationEligibilityBatch ?? evaluatePublicationEligibilityBatch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    return await withTimeout(
      (async (): Promise<FichaTecnicaRun> => {
        let stageStartedAt = performance.now();
        const pimProductId = await resolvePimProductId(product.slug);
        timings.productResolutionMs = performance.now() - stageStartedAt;
        if (!pimProductId) return { ...SKIPPED, reason: "PRODUCT_NOT_RESOLVED" };

        // Canary allowlist FIRST (cheapest possible short-circuit): a
        // product with zero active-canary-batch membership rows behaves
        // exactly like mode=shadow -- Woo-only, unconditionally. This is
        // the REAL, non-hardcoded allowlist (lib/pim/publication-read-model.ts's
        // getActiveCanaryMembership, already existing, already tested,
        // never wired to any route before this round).
        stageStartedAt = performance.now();
        const membership = await membershipFn(pimProductId);
        timings.membershipMs = performance.now() - stageStartedAt;
        if (membership.length === 0) return { ...SKIPPED, productResolved: true, membershipCount: 0, reason: "NO_ACTIVE_CANARY_MEMBERSHIP" };

        const canaryCodes = new Set(membership.map((m) => m.attributeCode));
        stageStartedAt = performance.now();
        const published = await publishedFn(pimProductId);
        timings.publicationReadMs = performance.now() - stageStartedAt;
        if (published.length === 0) return { ...SKIPPED, productResolved: true, membershipCount: membership.length, publishedCount: 0, reason: "NO_PUBLISHED_ATTRIBUTES" };

        // getPublishedAttributesForProduct already enforces
        // isPublicationExposable (published + active batch + source PAV
        // still matches + attribute/value still resolve) -- intersecting
        // with the canary allowlist means a row must pass BOTH checks.
        const canaryPublished = published.filter((record) => canaryCodes.has(record.attributeSlug));
        if (canaryPublished.length === 0) {
          return { ...SKIPPED, productResolved: true, membershipCount: membership.length, publishedCount: published.length, intersectionCount: 0, reason: "NO_INTERSECTION" };
        }

        // A3.7-A-R14-R5's residual-risk finding: a review can be recorded
        // AFTER an attribute is published, without automatically
        // unpublishing it. Re-run the REAL eligibility gate, fresh, right
        // now -- never trust the historical publish-time decision alone
        // for something as high-stakes as live public exposure (shadow
        // telemetry tolerates this staleness; public rendering must not).
        const db = getDatabase();
        stageStartedAt = performance.now();
        const eligibility = await eligibilityBatchFn(
          db,
          canaryPublished.map((record) => ({ productId: record.productId, attributeId: record.attributeId, attributeValueId: record.attributeValueId })),
        );
        timings.eligibilityMs = performance.now() - stageStartedAt;
        const stillEligible: PublishedAttributeRecord[] = canaryPublished.filter((record) => {
          const key = `${record.productId}:${record.attributeId}:${record.attributeValueId}`;
          return eligibility.get(key)?.eligible === true;
        });
        if (stillEligible.length === 0) {
          return { ...SKIPPED, productResolved: true, membershipCount: membership.length, publishedCount: published.length, intersectionCount: canaryPublished.length, eligibleCount: 0, reason: "NO_CURRENTLY_ELIGIBLE_ATTRIBUTES" };
        }

        stageStartedAt = performance.now();
        const official = mapWooProductToCatalog(product);
        const candidate = buildPimCatalogCandidate(pimProductId, stillEligible);
        const { specifications, additionCount } = buildFichaTecnicaSpecifications(official, candidate);
        timings.mergeMs = performance.now() - stageStartedAt;
        const base = { productResolved: true, membershipCount: membership.length, publishedCount: published.length, intersectionCount: canaryPublished.length, eligibleCount: stillEligible.length, mergeAdditionCount: additionCount };
        if (additionCount === 0) return { ...base, specifications: undefined, reason: "NO_SAFE_MERGE_ADDITIONS" };
        return { ...base, specifications, reason: "SUCCESS" };
      })(),
      timeoutMs,
    );
  } catch (error) {
    // Fail-closed: ANY error (DB, timeout, mapping) falls back to
    // undefined -- today's exact Woo-only rendering, never a partial or
    // broken Ficha Técnica.
    const isTimeout = error instanceof Error && error.message === "PIM_FICHA_TECNICA_TIMEOUT";
    return { ...SKIPPED, reason: isTimeout ? "TIMEOUT" : "ERROR" };
  }
}
