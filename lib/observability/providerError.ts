import "server-only";

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,100}$/;

function extractSafeCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["code", "type", "error_code"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && SAFE_CODE.test(candidate)) return candidate;
  }
  return undefined;
}

export function sanitizeProviderError(input: {
  provider: "woocommerce" | "pagbank" | "mercadopago";
  operation: string;
  status: number | "timeout" | "network_error";
  payload?: unknown;
}) {
  return {
    provider: input.provider,
    operation: input.operation.replace(/[^A-Za-z0-9_./:-]/g, "").slice(0, 160),
    status: input.status,
    code: extractSafeCode(input.payload) ?? "PROVIDER_REQUEST_FAILED",
  } as const;
}
