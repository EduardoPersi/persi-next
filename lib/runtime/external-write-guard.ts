import "server-only";
import { getRuntimeSafetyPolicy, type RuntimeSafetyPolicy } from "@/lib/runtime/runtime-safety-policy";

// A3.6-D1.6 Section 10/14: a central, small guard called BEFORE any real
// external provider call. Section 10 is explicit: "não colocar a
// credencial" is useful but must never be the ONLY barrier -- even if a
// real credential is accidentally configured in staging, this guard
// refuses the operation before any network call is made.
export class StagingExternalWriteBlockedError extends Error {
  readonly code = "STAGING_EXTERNAL_WRITE_BLOCKED";
  readonly integration: string;
  readonly operation: string;
  constructor(integration: string, operation: string) {
    super(`Operação externa bloqueada neste ambiente (${integration}:${operation}). Este ambiente não tem permissão para gravações externas reais.`);
    this.integration = integration;
    this.operation = operation;
  }
}

export interface ExternalWriteCheck {
  integration: string;
  operation: string;
}

/**
 * Throws StagingExternalWriteBlockedError when the given policy field is
 * false. Never reveals credentials/configuration -- the error carries only
 * the integration/operation names supplied by the CALLER, never anything
 * read from environment variables.
 */
export function assertExternalWriteAllowed(check: ExternalWriteCheck, policyField: keyof RuntimeSafetyPolicy, policy: RuntimeSafetyPolicy = getRuntimeSafetyPolicy()): void {
  if (policy[policyField] !== true) {
    throw new StagingExternalWriteBlockedError(check.integration, check.operation);
  }
}

export function assertPaymentsAllowed(provider: string, operation: string, policy: RuntimeSafetyPolicy = getRuntimeSafetyPolicy()): void {
  assertExternalWriteAllowed({ integration: provider, operation }, "allowPayments", policy);
}

export function assertWooMutationAllowed(operation: string, policy: RuntimeSafetyPolicy = getRuntimeSafetyPolicy()): void {
  assertExternalWriteAllowed({ integration: "woocommerce", operation }, "allowWooMutations", policy);
}

export function assertCheckoutSubmissionAllowed(policy: RuntimeSafetyPolicy = getRuntimeSafetyPolicy()): void {
  assertExternalWriteAllowed({ integration: "checkout", operation: "submit" }, "allowCheckoutSubmission", policy);
}

export function assertMessagingAllowed(channel: string, operation: string, policy: RuntimeSafetyPolicy = getRuntimeSafetyPolicy()): void {
  assertExternalWriteAllowed({ integration: channel, operation }, "allowTransactionalMessaging", policy);
}

export function assertErpWriteAllowed(operation: string, policy: RuntimeSafetyPolicy = getRuntimeSafetyPolicy()): void {
  assertExternalWriteAllowed({ integration: "erp", operation }, "allowErpWrites", policy);
}

export function assertShippingWriteAllowed(operation: string, policy: RuntimeSafetyPolicy = getRuntimeSafetyPolicy()): void {
  assertExternalWriteAllowed({ integration: "melhor-envio", operation }, "allowShippingWrites", policy);
}
