import { randomUUID } from "node:crypto";

// Split out of instrumentation.ts on purpose: Next.js's Turbopack bundler
// statically analyzes instrumentation.ts for BOTH the nodejs and edge
// runtimes (this app also has edge middleware -- "Proxy (Middleware)" in
// the build output), regardless of the NEXT_RUNTIME guard being a runtime
// check, not a build-time one. A top-level `node:crypto` import and a
// `process.pid` reference directly inside instrumentation.ts broke the
// edge bundle during the first staging deploy of this file (build logs:
// "A Node.js module is loaded ('node:crypto')... Ecmascript file had an
// error", "A Node.js API is used (process.pid)... Ecmascript file had an
// error") -- the build still reported "completed", but the edge bundle
// error is the reason the very next runtime-log read came back empty.
// Only importing this file via a dynamic `await import()` gated by the
// NEXT_RUNTIME check (see instrumentation.ts) keeps every Node-only
// reference out of the edge bundle's static analysis entirely.
export function logProcessBoot(): void {
  console.log(`[boot] pid=${process.pid} bootId=${randomUUID()} startedAt=${new Date().toISOString()}`);
}
