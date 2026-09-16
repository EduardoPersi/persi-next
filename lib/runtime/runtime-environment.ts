import "server-only";

// A3.6-D1.6 Section 2/8: the single authoritative runtime identity for the
// whole app -- NEVER process.env.PERSI_RUNTIME_ENV read directly elsewhere,
// and deliberately NOT NODE_ENV. `next start` always runs a production
// build, so NODE_ENV="production" is identical on a future staging deploy
// and on real production -- it structurally cannot answer "which logical
// environment is this". PERSI_RUNTIME_ENV answers a different question.
//
// Compatibility rule (Section 8, explicit): production today has NO
// PERSI_RUNTIME_ENV set. Missing or unrecognized values MUST resolve to
// "production" -- the exact behavior production already has -- so
// introducing this file changes NOTHING for the current production
// deployment. Only an explicit PERSI_RUNTIME_ENV=staging turns on any
// staging-specific behavior anywhere in the app.
export type PersiRuntimeEnvironment = "production" | "staging" | "development" | "test";

const RECOGNIZED_VALUES: readonly PersiRuntimeEnvironment[] = ["production", "staging", "development", "test"];

export function getPersiRuntimeEnvironment(environment: NodeJS.ProcessEnv = process.env): PersiRuntimeEnvironment {
  const raw = environment.PERSI_RUNTIME_ENV;
  return (RECOGNIZED_VALUES as readonly string[]).includes(raw ?? "") ? (raw as PersiRuntimeEnvironment) : "production";
}

export function isProductionRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
  return getPersiRuntimeEnvironment(environment) === "production";
}

export function isStagingRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
  return getPersiRuntimeEnvironment(environment) === "staging";
}

export function isDevelopmentRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
  return getPersiRuntimeEnvironment(environment) === "development";
}
