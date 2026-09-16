import "server-only";

// Types live HERE (not in publication-shadow-runtime.ts) specifically to
// avoid a circular module dependency: this file is the leaf that the
// runtime orchestrator depends on, never the reverse.

export type CatalogRouteKind = "product" | "category" | "search";

export type ShadowStatus =
  | "skipped_mode_off"
  | "skipped_sampling"
  | "skipped_no_pim_product"
  | "skipped_zero_official_attributes"
  | "completed"
  | "timeout"
  | "error";

export interface PimCatalogShadowTelemetryEvent {
  /** PIM-internal product id (uuid), present only when sampled for
   * diagnostic depth. Never a customer identifier, never PII. */
  productId: string | null;
  routeKind: CatalogRouteKind;
  /** Coarse, low-cardinality summary across all attribute differences
   * (worst classification found), or a status-derived label when the
   * comparison never ran. Aggregable across routeKind/status. */
  classification: string;
  differenceCount: number;
  publishedAttributeCount: number;
  durationMs: number;
  shadowStatus: ShadowStatus;
  errorClass: string | null;
}

/** Plain-function form used internally by the orchestrator (what every
 * test injects via `deps.telemetry`). May return a promise; the
 * orchestrator never awaits it and defensively swallows any rejection --
 * telemetry is always best-effort, never on the critical path. */
export type ShadowTelemetrySink = (event: PimCatalogShadowTelemetryEvent) => void | Promise<void>;

// A3.6-C Section 8/9: audited the project for existing observability
// infrastructure before writing anything new. Findings (see
// docs/pim/13-shadow-activation-qualification.md Section F for the full
// audit): no Sentry, no OpenTelemetry, no Winston/Pino, no external log
// aggregator dependency anywhere in package.json. The ONLY existing
// convention for this class of internal diagnostic event is a plain
// `console.info("[tag]", event)` call, already used by the sibling
// Woo/Postgres shadow (services/catalog/productShadow.ts) and by several
// services/woocommerce/*.ts files. Hostinger's own hosting also already
// exposes Node.js runtime stdout/stderr logs (hosting_getNode_jsRuntimeLogsV1)
// as an existing collection point -- no new external service is required
// to make a console-based sink observable in the real deployment target.
//
// Per Section 8's explicit instruction ("NÃO instalar dependência
// automaticamente. NÃO criar serviço externo."), this module adapts that
// existing convention instead of introducing a new logging dependency.

export interface PimShadowTelemetrySink {
  emit(event: PimCatalogShadowTelemetryEvent): Promise<void> | void;
}

/** The safest possible sink: does nothing. This is the DEFAULT used by
 * lib/pim/publication-shadow-runtime.ts when no sink is injected -- A3.6-C
 * is a qualification round, not an activation round, so no destination is
 * wired as the real default yet. */
export const noopPimShadowTelemetrySink: PimShadowTelemetrySink = {
  emit() {},
};

/** Adapts the project's existing "[tag] event" console convention. Not
 * wired as any default -- available for a future activation round to
 * select explicitly (see the runbook in docs/pim/13). */
export const consolePimShadowTelemetrySink: PimShadowTelemetrySink = {
  emit(event) {
    console.info("[pim-catalog-shadow]", event);
  },
};

/** Test/diagnostic helper: collects emitted events in-memory. Not for
 * production use (unbounded array) -- exported so tests share one
 * implementation instead of hand-rolling a collector each time. */
export function createCollectingTelemetrySink(): PimShadowTelemetrySink & { events: PimCatalogShadowTelemetryEvent[] } {
  const events: PimCatalogShadowTelemetryEvent[] = [];
  return { events, emit: (event) => { events.push(event); } };
}

export type PimShadowTelemetrySinkName = "noop" | "console";

/**
 * A3.6-D1 Section 12/13: the smallest possible change to let a future
 * controlled activation select the console sink instead of noop, WITHOUT
 * changing the runtime's fail-safe default. Reads PIM_SHADOW_TELEMETRY_SINK
 * (accepted: "noop" | "console"); any missing/unknown value resolves to
 * "noop" -- the same default-deny pattern already used by
 * getPimPublicationFlags for mode/sample-rate. Not set in any real
 * environment this round; this function exists so a future activation only
 * needs to SET an env var, never redeploy new code to change telemetry
 * destination.
 */
export function getConfiguredTelemetrySink(environment: NodeJS.ProcessEnv = process.env): PimShadowTelemetrySink {
  const raw = environment.PIM_SHADOW_TELEMETRY_SINK;
  return raw === "console" ? consolePimShadowTelemetrySink : noopPimShadowTelemetrySink;
}

/**
 * Adapts an object-shaped PimShadowTelemetrySink into the plain-function
 * ShadowTelemetrySink the runtime orchestrator calls internally.
 * Section 10 (telemetry failure isolation): defensively swallows a
 * synchronous throw AND a rejected promise from `sink.emit` here, at the
 * adapter boundary -- a sink implementation is never trusted to behave.
 * The orchestrator's own emit() guard (single-fire, try/catch) is a
 * second, independent layer on top of this.
 */
export function toTelemetryFunction(sink: PimShadowTelemetrySink): ShadowTelemetrySink {
  return (event) => {
    try {
      const result = sink.emit(event);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch(() => {});
      }
    } catch {
      // A throwing/misbehaving sink must never affect the caller.
    }
  };
}
