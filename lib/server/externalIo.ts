import "server-only";
import { appendFileSync } from "node:fs";

export const OFFLINE_VALIDATION_FLAG = "PERSI_OFFLINE_VALIDATION";

export type ExternalProvider =
  | "woocommerce" | "wordpress" | "instagram" | "olist"
  | "payments" | "shipping" | "openai" | "remote_supabase" | "other";

export class ExternalIoBlockedError extends Error {
  readonly code = "EXTERNAL_IO_BLOCKED";
  constructor(readonly provider: ExternalProvider | string) {
    super(`EXTERNAL_IO_BLOCKED:${provider}`);
    this.name = "ExternalIoBlockedError";
  }
}

export function isOfflineValidation(env: NodeJS.ProcessEnv = process.env) {
  return env[OFFLINE_VALIDATION_FLAG] === "1";
}

export function assertExternalIoAllowed(provider: ExternalProvider | string) {
  if (isOfflineValidation()) {
    const auditFile = process.env.PERSI_OFFLINE_AUDIT_FILE;
    if (auditFile) appendFileSync(auditFile, `${JSON.stringify({ kind: "provider_blocked", provider, pid: process.pid })}\n`);
    throw new ExternalIoBlockedError(provider);
  }
}
