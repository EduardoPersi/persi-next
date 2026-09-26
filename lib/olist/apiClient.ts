import "server-only";

import type { PersiRole } from "@/lib/db/nativeCommerceAuthority";
import { getValidOlistAccessToken } from "./oauthClient";
import { consumeOlistRateLimit, isOlistCircuitOpen, recordOlistApiResult } from "./rateLimiter";
import type { OlistOAuthApp, OlistOAuthEnvironment } from "./oauthTokens";

// Read-only Fase 1 methods only (docs/native-commerce/olist-integration-design.md
// Section 14.6: "próxima rodada... só leitura da API do Olist"). No order
// creation, no product/price/stock writes -- those stay design-only until
// a separate, explicitly authorized round.

export const OLIST_API_BASE = "https://api.tiny.com.br/public-api/v3";

export class OlistApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "OlistApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export interface OlistApiClientOptions {
  role: PersiRole;
  app: Extract<OlistOAuthApp, "catalogo">;
  environment: OlistOAuthEnvironment;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
}

const MAX_ATTEMPTS = 3;

function backoffDelayMs(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 150);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Enforces, in order: circuit breaker pre-check (no write, cheap), local
// rate-limit token bucket (shared across processes, reserves this site's
// slice of Olist's real 60 req/min account-wide limit), then the actual
// HTTP call with exponential backoff on 429/5xx, recording the outcome to
// the circuit breaker either way. Never called from inside a Postgres
// transaction/lock -- every DB call this makes (breaker/bucket) is its own
// standalone statement, same rule as the OAuth client.
async function olistApiRequest(
  options: OlistApiClientOptions,
  path: string,
  searchParams?: Record<string, string | number | undefined>,
): Promise<unknown> {
  const fetchImplementation = options.fetchImplementation ?? fetch;

  if (await isOlistCircuitOpen(options.role)) {
    throw new OlistApiError("OLIST_CIRCUIT_OPEN", 503, false);
  }

  const url = new URL(`${OLIST_API_BASE}${path}`);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let lastError: OlistApiError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const allowed = await consumeOlistRateLimit(options.role);
    if (!allowed) {
      lastError = new OlistApiError("OLIST_RATE_LIMIT_EXCEEDED", 429, true);
      await sleep(backoffDelayMs(attempt));
      continue;
    }

    const accessToken = await getValidOlistAccessToken({
      role: options.role,
      app: options.app,
      environment: options.environment,
      fetchImplementation,
    });

    const response = await fetchImplementation(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      lastError = new OlistApiError(`OLIST_HTTP_${response.status}`, response.status, true);
      await recordOlistApiResult(options.role, false);
      await sleep(backoffDelayMs(attempt));
      continue;
    }

    if (!response.ok) {
      await recordOlistApiResult(options.role, response.status !== 401 && response.status !== 403);
      throw new OlistApiError(`OLIST_HTTP_${response.status}`, response.status, false);
    }

    await recordOlistApiResult(options.role, true);
    return response.json().catch(() => null);
  }

  await recordOlistApiResult(options.role, false);
  throw lastError ?? new OlistApiError("OLIST_API_UNAVAILABLE", 503, true);
}

export interface OlistStockBalance {
  idProduto: number;
  saldoFisico: number;
  saldoDisponivel: number;
}

// GET /estoque/{idProduto} -- read-only, used by the cart/checkout live
// stock check (Section 5.7) and by webhook/reconciliation re-query
// (Section 5.2/5.6). Response shape per olist-integration-design.md
// Section 2.1/2.2 ("F"=físico, "D"=disponível).
export async function getOlistProductStock(
  options: OlistApiClientOptions,
  idProduto: number,
): Promise<OlistStockBalance> {
  const body = (await olistApiRequest(options, `/estoque/${idProduto}`)) as {
    saldo?: Array<{ tipoEstoque?: string; saldo?: number }>;
  } | null;
  const entries = Array.isArray(body?.saldo) ? body!.saldo! : [];
  const physical = entries.find((entry) => entry.tipoEstoque === "F")?.saldo ?? 0;
  const available = entries.find((entry) => entry.tipoEstoque === "D")?.saldo ?? physical;
  return { idProduto, saldoFisico: physical, saldoDisponivel: available };
}

export interface OlistProductSummary {
  id: number;
  sku: string;
  gtin: string | null;
}

// GET /produtos?codigo=... -- used once per SKU by the mapping derivation
// script (Section 4) to resolve idProduto; never called from the cart
// live-stock path (that needs stock, not catalog metadata).
export async function findOlistProductBySku(
  options: OlistApiClientOptions,
  sku: string,
): Promise<OlistProductSummary[]> {
  const body = (await olistApiRequest(options, "/produtos", { codigo: sku, limit: 100, offset: 0 })) as {
    itens?: Array<{ id?: number; sku?: string; gtin?: string }>;
  } | null;
  const items = Array.isArray(body?.itens) ? body!.itens! : [];
  return items
    .filter((item): item is { id: number; sku: string; gtin?: string } => typeof item.id === "number" && typeof item.sku === "string" && item.sku === sku)
    .map((item) => ({ id: item.id, sku: item.sku, gtin: item.gtin ?? null }));
}
