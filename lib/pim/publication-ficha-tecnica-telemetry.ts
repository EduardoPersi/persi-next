import "server-only";
import type { FichaTecnicaDiagnosticEvent } from "@/lib/pim/publication-ficha-tecnica-diagnostics";

// A3.7-A-R17-R2A: mirrors lib/pim/publication-shadow-telemetry.ts's own
// established pattern (noop-by-default, console sink gated by the SAME
// PIM_SHADOW_TELEMETRY_SINK env var the operator already controls) rather
// than inventing a new configuration surface or a new dependency. Kept as
// its own small module -- not merged into publication-shadow-telemetry.ts
// -- because this event has a different shape and a different tag, and the
// Ficha Técnica diagnostic path must stay independently auditable from the
// unrelated Woo/Postgres catalog shadow.

export type FichaTecnicaTelemetrySink = (event: FichaTecnicaDiagnosticEvent) => void | Promise<void>;

export const noopFichaTecnicaTelemetrySink: FichaTecnicaTelemetrySink = () => {};

export const consoleFichaTecnicaTelemetrySink: FichaTecnicaTelemetrySink = (event) => {
  console.info("[pim-ficha-tecnica-canary]", event);
};

/** Same default-deny pattern as getConfiguredTelemetrySink: any value other
 * than the literal "console" resolves to noop. Reuses PIM_SHADOW_TELEMETRY_SINK
 * (not a new env var) -- the operator already has exactly one knob to turn
 * this class of diagnostic output on, and this feature stays behind it. */
export function getConfiguredFichaTecnicaTelemetrySink(environment: NodeJS.ProcessEnv = process.env): FichaTecnicaTelemetrySink {
  return environment.PIM_SHADOW_TELEMETRY_SINK === "console" ? consoleFichaTecnicaTelemetrySink : noopFichaTecnicaTelemetrySink;
}

/** Section 15: fail-closed by environment. This diagnostic event must never
 * appear outside staging, regardless of sink configuration -- a production
 * (or any non-staging) PERSI_RUNTIME_ENV suppresses it unconditionally,
 * before the sink is even consulted. */
export function isFichaTecnicaDiagnosticsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.PERSI_RUNTIME_ENV === "staging";
}

/** Test/diagnostic helper: collects emitted events in-memory, mirroring
 * publication-shadow-telemetry.ts's own createCollectingTelemetrySink. */
export function createCollectingFichaTecnicaTelemetrySink(): FichaTecnicaTelemetrySink & { events: FichaTecnicaDiagnosticEvent[] } {
  const events: FichaTecnicaDiagnosticEvent[] = [];
  const sink: FichaTecnicaTelemetrySink & { events: FichaTecnicaDiagnosticEvent[] } = (event) => { events.push(event); };
  sink.events = events;
  return sink;
}

/** Defensive adapter: a throwing/misbehaving sink, or a rejected async
 * sink, must never affect the caller. Mirrors toTelemetryFunction's own
 * guard in publication-shadow-telemetry.ts. */
export function emitFichaTecnicaDiagnostic(sink: FichaTecnicaTelemetrySink, event: FichaTecnicaDiagnosticEvent): void {
  try {
    const result = sink(event);
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // A throwing telemetry sink must never affect the caller.
  }
}
