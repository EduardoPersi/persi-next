// canary-minimum-scope.md §5.1: staging runtime logs show two full Next.js
// startup sequences per restart, and several in-memory primitives assume a
// single persistent Node process on Hostinger. register() runs once per
// runtime this app has (nodejs and, separately, edge for the middleware) --
// the dynamic import below, gated by the NEXT_RUNTIME check, keeps every
// Node-only API (node:crypto, process.pid -- see lib/observability/bootLog.ts)
// out of the edge bundle's static analysis. A previous version of this file
// imported node:crypto directly and referenced process.pid at its top
// level, which broke Turbopack's edge bundle during the first staging
// deploy (build logs: "Ecmascript file had an error" for this exact file,
// twice) even though the build itself still reported "completed".
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logProcessBoot } = await import("./lib/observability/bootLog");
  logProcessBoot();
}
