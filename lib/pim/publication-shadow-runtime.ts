import "server-only";
// Explicit ".js" extension: Next.js's own package.json has no "exports"
// map, so a bare "next/server" specifier does not resolve under strict
// Node ESM resolution (only Next's webpack/Turbopack bundler special-cases
// it). The explicit extension resolves identically under both the real
// Next.js build and this repo's plain-Node test loader
// (scripts/database/typescript-loader.mjs).
import { after } from "next/server.js";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db";
import type { CatalogProduct } from "@/lib/catalog/domain";
import { getPimPublicationFlags, type PimPublicationMode } from "@/lib/pim/publication-flags";
import { getPublishedAttributesForProducts, type PublishedAttributeRecord } from "@/lib/pim/publication-read-model";
import { buildPimCatalogCandidate } from "@/lib/pim/publication-candidate";
import { compareOfficialWithPimCandidate, type CatalogShadowComparison } from "@/lib/pim/publication-shadow-comparison";
import { getConfiguredTelemetrySink, toTelemetryFunction, type CatalogRouteKind, type PimCatalogShadowTelemetryEvent, type ShadowStatus, type ShadowTelemetrySink } from "@/lib/pim/publication-shadow-telemetry";
import { isPimShadowSafeToRun } from "@/lib/pim/publication-runtime-preflight";

export type { CatalogRouteKind, PimCatalogShadowTelemetryEvent, ShadowStatus, ShadowTelemetrySink };

// A3.6-B: the runtime orchestrator that connects the A3.6-A foundation to a
// REAL request path, in shadow mode only. The one invariant every line of
// this file exists to protect:
//
//   the value returned to the caller of runPimCatalogShadow's SIBLING code
//   path (the official read) is NEVER awaited, blocked, or altered by
//   anything in here.
//
// Architecture (Section 8/12): "const official = await officialRead();
// scheduleShadowObservation(official); return official" -- never
// "combineOfficialAndPim(...)". This module has no function that returns a
// merged/decided catalog value; it only ever produces telemetry.

export interface PimCatalogShadowDependencies {
  mode?: PimPublicationMode;
  sampleRatePercent?: number;
  timeoutMs?: number;
  telemetry?: ShadowTelemetrySink;
  /** Injectable for tests/disposable fixtures; production default resolves
   * against the real database. */
  resolvePimProductId?: (slug: string) => Promise<string | null>;
  fetchPublishedAttributes?: (productIds: string[]) => Promise<Map<string, PublishedAttributeRecord[]>>;
  /** Injectable for tests exercising "comparator throws" without relying
   * on contrived malformed input to trigger it naturally. */
  compare?: typeof compareOfficialWithPimCandidate;
  /** Injectable scheduler so tests can run the observation synchronously
   * instead of racing a real post-response callback. Production default:
   * next/server's after() with a safe fallback (see scheduleWithAfter). */
  schedule?: (work: () => Promise<void>) => void;
  /** A3.6-D1.5: injectable database-binding guard. Default checks
   * DATABASE_URL's project ref against EXPECTED_STAGING_PROJECT_REF
   * (lib/pim/publication-runtime-preflight.ts). If this returns false, the
   * effective mode is forced to "off" regardless of PIM_PUBLICATION_MODE --
   * DISABLE_PIM_SHADOW, not a process crash. */
  isSafeToRun?: () => boolean;
}

const DEFAULT_TIMEOUT_MS = 500;

/** FNV-1a: fast, deterministic, no external dependency. Same product
 * always lands in the same sample bucket across requests/instances --
 * required for reproducible sampling (Section 16), unlike Math.random(). */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function isSampled(key: string, sampleRatePercent: number): boolean {
  if (sampleRatePercent <= 0) return false;
  if (sampleRatePercent >= 100) return true;
  return stableHash(key) % 100 < sampleRatePercent;
}

// A3.7-A-R15: exported (was module-private) so the new Ficha Técnica canary
// orchestrator (services/catalog/productFichaTecnica.ts) can resolve a
// slug's PIM product id without duplicating this exact query -- same
// function, same behavior, just reusable outside this file too.
export async function defaultResolvePimProductId(slug: string): Promise<string | null> {
  const rows = (await getDatabase().execute(sql`select id::text as id from public.products where slug = ${slug} limit 1`)) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PIM_SHADOW_TIMEOUT")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Worst-first ordering so the aggregate telemetry label is stable and
 * meaningful even with many attribute-level differences. */
const CLASSIFICATION_SEVERITY_ORDER = ["BLOCKED", "UNRESOLVABLE", "VALUE_DIFFERENCE", "MULTI_VALUE_DIFFERENCE", "ORDER_ONLY_DIFFERENCE", "PIM_ONLY", "OFFICIAL_ONLY", "MATCH"] as const;

function summarizeClassification(comparison: CatalogShadowComparison): string {
  if (comparison.differences.length === 0) return "NO_DIFFERENCES";
  for (const severity of CLASSIFICATION_SEVERITY_ORDER) {
    if (comparison.differences.some((d) => d.classification === severity)) return severity;
  }
  return "UNKNOWN";
}

function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.message === "PIM_SHADOW_TIMEOUT" ? "timeout" : error.constructor.name;
  return "unknown";
}

async function observeOnce(official: CatalogProduct, routeKind: CatalogRouteKind, deps: Required<Pick<PimCatalogShadowDependencies, "timeoutMs" | "telemetry" | "resolvePimProductId" | "fetchPublishedAttributes" | "compare">>): Promise<void> {
  const startedAt = performance.now();
  // Once a timeout fires, the raced-away work (Promise cannot truly be
  // cancelled) may still be running and could complete/emit later --
  // guarded here so a single observation NEVER produces two telemetry
  // events (found via real staging validation: a slow cold connection hit
  // the timeout, then the abandoned resolvePimProductId call finished
  // moments later and tried to emit a second "completed" event for the
  // same request).
  let emitted = false;
  const emit = (partial: Omit<PimCatalogShadowTelemetryEvent, "durationMs" | "routeKind">) => {
    if (emitted) return;
    emitted = true;
    try {
      // A3.6-C Section 10: deps.telemetry may be an async sink. Its
      // returned promise is never awaited (telemetry is always
      // best-effort, never on the critical path) but a rejection left
      // unattached would be an unhandled promise rejection -- caught here
      // defensively, in addition to toTelemetryFunction's own guard for
      // sinks adapted through it.
      const result = deps.telemetry({ routeKind, durationMs: performance.now() - startedAt, ...partial });
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch(() => {});
      }
    } catch {
      // A throwing telemetry sink must never affect the caller.
    }
  };

  if (official.attributes.length === 0) {
    // Nothing meaningful to compare; avoid manufacturing noise.
    emit({ productId: null, classification: "NO_OFFICIAL_ATTRIBUTES", differenceCount: 0, publishedAttributeCount: 0, shadowStatus: "skipped_zero_official_attributes", errorClass: null });
    return;
  }

  try {
    const work = (async () => {
      const productId = await deps.resolvePimProductId(official.slug);
      if (!productId) {
        emit({ productId: null, classification: "NO_PIM_PRODUCT", differenceCount: 0, publishedAttributeCount: 0, shadowStatus: "skipped_no_pim_product", errorClass: null });
        return;
      }
      const map = await deps.fetchPublishedAttributes([productId]);
      const publishedAttributes = map.get(productId) ?? [];
      const candidate = buildPimCatalogCandidate(productId, publishedAttributes);
      const comparison = deps.compare(official, candidate);
      emit({
        productId,
        classification: summarizeClassification(comparison),
        differenceCount: comparison.differences.length,
        publishedAttributeCount: publishedAttributes.length,
        shadowStatus: "completed",
        errorClass: null,
      });
    })();
    await withTimeout(work, deps.timeoutMs);
  } catch (error) {
    const isTimeout = error instanceof Error && error.message === "PIM_SHADOW_TIMEOUT";
    try {
      emit({ productId: null, classification: "ERROR", differenceCount: 0, publishedAttributeCount: 0, shadowStatus: isTimeout ? "timeout" : "error", errorClass: errorClassOf(error) });
    } catch {
      // Section 9: a telemetry-sink failure must never propagate anywhere,
      // including back to whatever scheduled this observation.
    }
  }
}

/** Best-effort "run after the response" scheduler. Prefers next/server's
 * after() (the framework's own primitive for exactly this use case, safe
 * across serverless/edge/persistent-server hosting alike); falls back to
 * the same bare fire-and-forget pattern already used by the pre-existing
 * Woo/Postgres shadow (services/catalog/productShadow.ts) whenever after()
 * is not callable in the current context -- e.g. outside a request scope,
 * such as in tests or disposable scripts, or an older/edge runtime that
 * does not support it. after() throws synchronously in those cases, so a
 * plain try/catch is sufficient; this function itself never throws. */
function scheduleWithAfter(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work().catch(() => undefined);
  }
}

/**
 * Entry point. Call this AFTER the official value is already computed and
 * about to be returned -- never before, never awaited by the caller. Zero
 * PIM database access happens when mode is "off" (checked before any
 * dependency, including resolvePimProductId, ever runs) or when the
 * request is not sampled.
 */
export function runPimCatalogShadow(official: CatalogProduct, routeKind: CatalogRouteKind, deps: PimCatalogShadowDependencies = {}): void {
  const flags = getPimPublicationFlags();
  const mode = deps.mode ?? flags.mode;
  const telemetry = deps.telemetry ?? toTelemetryFunction(getConfiguredTelemetrySink());

  if (mode === "off") {
    telemetry({ productId: null, routeKind, classification: "MODE_OFF", differenceCount: 0, publishedAttributeCount: 0, durationMs: 0, shadowStatus: "skipped_mode_off", errorClass: null });
    return;
  }

  const isSafeToRun = deps.isSafeToRun ?? isPimShadowSafeToRun;
  if (!isSafeToRun()) {
    // DISABLE_PIM_SHADOW, not a process crash: DATABASE_URL is not bound
    // to the expected staging project ref. Treated identically to mode=off.
    telemetry({ productId: null, routeKind, classification: "UNSAFE_DB_BINDING", differenceCount: 0, publishedAttributeCount: 0, durationMs: 0, shadowStatus: "skipped_mode_off", errorClass: null });
    return;
  }

  const sampleRatePercent = deps.sampleRatePercent ?? flags.shadowSampleRatePercent;
  if (!isSampled(official.slug, sampleRatePercent)) {
    telemetry({ productId: null, routeKind, classification: "NOT_SAMPLED", differenceCount: 0, publishedAttributeCount: 0, durationMs: 0, shadowStatus: "skipped_sampling", errorClass: null });
    return;
  }

  const resolvedDeps = {
    timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    telemetry,
    resolvePimProductId: deps.resolvePimProductId ?? defaultResolvePimProductId,
    fetchPublishedAttributes: deps.fetchPublishedAttributes ?? getPublishedAttributesForProducts,
    compare: deps.compare ?? compareOfficialWithPimCandidate,
  };
  const schedule = deps.schedule ?? scheduleWithAfter;
  schedule(() => observeOnce(official, routeKind, resolvedDeps));
}

/**
 * Batch variant for listing/search routes (Section 17/20): resolves ALL
 * products' PIM ids and published attributes in as few queries as
 * possible, never one query per product. Still per-product sampled and
 * per-product telemetry -- sampling controls diagnostic volume, not query
 * batching.
 */
export function runPimCatalogShadowForList(officials: readonly CatalogProduct[], routeKind: CatalogRouteKind, deps: PimCatalogShadowDependencies = {}): void {
  const flags = getPimPublicationFlags();
  const mode = deps.mode ?? flags.mode;
  const telemetry = deps.telemetry ?? toTelemetryFunction(getConfiguredTelemetrySink());
  if (mode === "off" || officials.length === 0) return;

  const isSafeToRun = deps.isSafeToRun ?? isPimShadowSafeToRun;
  if (!isSafeToRun()) return;

  const sampleRatePercent = deps.sampleRatePercent ?? flags.shadowSampleRatePercent;
  const sampled = officials.filter((o) => isSampled(o.slug, sampleRatePercent));
  if (sampled.length === 0) return;

  const resolvedDeps = {
    timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    telemetry,
    resolvePimProductId: deps.resolvePimProductId ?? defaultResolvePimProductId,
    fetchPublishedAttributes: deps.fetchPublishedAttributes ?? getPublishedAttributesForProducts,
    compare: deps.compare ?? compareOfficialWithPimCandidate,
  };
  const schedule = deps.schedule ?? scheduleWithAfter;
  schedule(async () => {
    // One id-resolution pass and one batch published-attributes fetch for
    // the whole sampled sub-list, regardless of list size.
    const idsBySlug = new Map<string, string | null>();
    for (const official of sampled) idsBySlug.set(official.slug, await resolvedDeps.resolvePimProductId(official.slug));
    const productIds = [...idsBySlug.values()].filter((id): id is string => id !== null);
    const map = productIds.length > 0 ? await resolvedDeps.fetchPublishedAttributes(productIds) : new Map<string, PublishedAttributeRecord[]>();

    for (const official of sampled) {
      const startedAt = performance.now();
      const productId = idsBySlug.get(official.slug) ?? null;
      if (!productId) {
        telemetry({ productId: null, routeKind, classification: "NO_PIM_PRODUCT", differenceCount: 0, publishedAttributeCount: 0, durationMs: performance.now() - startedAt, shadowStatus: "skipped_no_pim_product", errorClass: null });
        continue;
      }
      try {
        const publishedAttributes = map.get(productId) ?? [];
        const candidate = buildPimCatalogCandidate(productId, publishedAttributes);
        const comparison = resolvedDeps.compare(official, candidate);
        telemetry({
          productId,
          routeKind,
          classification: summarizeClassification(comparison),
          differenceCount: comparison.differences.length,
          publishedAttributeCount: publishedAttributes.length,
          durationMs: performance.now() - startedAt,
          shadowStatus: "completed",
          errorClass: null,
        });
      } catch (error) {
        try {
          telemetry({ productId, routeKind, classification: "ERROR", differenceCount: 0, publishedAttributeCount: 0, durationMs: performance.now() - startedAt, shadowStatus: "error", errorClass: errorClassOf(error) });
        } catch { /* telemetry must never throw upstream */ }
      }
    }
  });
}
