export const MAX_SYNC_ATTEMPTS = 6;

export type SyncFailureKind = "transient" | "permanent";

export function deterministicEventId(input: { source: string; entityType: string; externalEntityId: string; sourceChangedAt?: string | null }) {
  return [input.source, input.entityType, input.externalEntityId, input.sourceChangedAt ?? "reconcile"].join(":");
}

export function retryDelayMs(attempt: number, random = Math.random()) {
  const bounded = Math.max(1, Math.min(attempt, MAX_SYNC_ATTEMPTS));
  return Math.min(60_000, 500 * 2 ** (bounded - 1)) + Math.floor(Math.max(0, Math.min(1, random)) * 250);
}

export function classifySyncFailure(error: unknown): SyncFailureKind {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 0;
  if (status === 429 || status >= 500 || status === 0) return "transient";
  return "permanent";
}

export function shouldProcessSourceVersion(current: string | Date | null | undefined, incoming: string | Date | null | undefined) {
  if (!current || !incoming) return true;
  return new Date(incoming).valueOf() >= new Date(current).valueOf();
}

export function convergenceMetrics(samplesMs: number[]) {
  const sorted = samplesMs.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
  return { count: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? 0 };
}
