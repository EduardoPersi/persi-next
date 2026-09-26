import { randomUUID } from "node:crypto";

// canary-minimum-scope.md §5.1: staging runtime logs show two full Next.js
// startup sequences per restart, and several in-memory primitives assume a
// single persistent Node process on Hostinger. register() runs once per
// server process on boot -- logging pid + a fresh random id here lets us
// tell, from the runtime logs alone, whether that's one process logging
// twice or two separate processes.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  console.log(
    `[boot] pid=${process.pid} bootId=${randomUUID()} startedAt=${new Date().toISOString()}`,
  );
}
