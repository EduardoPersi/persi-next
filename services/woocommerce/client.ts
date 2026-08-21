import { isTransientHttpStatus, withSingleRetry } from "@/lib/network/retry";

const STORE_API_PATH = "/wp-json/wc/store/v1";
const DEFAULT_REVALIDATE_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 10_000;

type QueryPrimitive = string | number | boolean;
type QueryValue =
  | QueryPrimitive
  | readonly QueryPrimitive[]
  | undefined;

export interface StoreApiRequestOptions {
  query?: Record<string, QueryValue>;
  revalidate?: number;
}

export interface StoreApiResponse<T> {
  data: T;
  total: number;
  totalPages: number;
}

export class StoreApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "StoreApiError";
  }
}

function getStoreApiUrl(
  endpoint: string,
  query?: Record<string, QueryValue>,
): URL {
  const wordpressUrl = process.env.WORDPRESS_URL;

  if (!wordpressUrl) {
    throw new StoreApiError(
      "A variável de ambiente WORDPRESS_URL não está configurada.",
    );
  }

  const url = new URL(
    `${STORE_API_PATH}/${endpoint.replace(/^\/+/, "")}`,
    wordpressUrl,
  );

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        url.searchParams.append(`${key}[]`, String(item));
      });
    } else if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

export async function storeApiGet<T>(
  endpoint: string,
  options: StoreApiRequestOptions = {},
): Promise<T> {
  const response = await storeApiGetWithMeta<T>(endpoint, options);

  return response.data;
}

export async function storeApiGetWithMeta<T>(
  endpoint: string,
  options: StoreApiRequestOptions = {},
): Promise<StoreApiResponse<T>> {
  const url = getStoreApiUrl(endpoint, options.query);

  try {
    let attempt = 0;
    const request = async () => {
      attempt += 1;
      const startedAt = performance.now();
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        next: {
          revalidate:
            options.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (process.env.WOO_REQUEST_DIAGNOSTICS === "1") {
        console.info("[woocommerce-outbound]", {
          api: "store",
          endpoint,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt),
          attempt,
          revalidate: options.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
        });
      }

      if (!response.ok) return { response, data: undefined };

      try {
        return { response, data: (await response.json()) as T };
      } catch {
        throw new StoreApiError("A Store API retornou JSON inválido.");
      }
    };
    const result = await withSingleRetry(request, {
      shouldRetryResult: ({ response }) => isTransientHttpStatus(response.status),
      onRetry: (reason) => {
        console.warn("[woocommerce-store-retry]", {
          endpoint,
          reason,
        });
      },
    });
    const { response, data } = result;

    if (!response.ok) {
      throw new StoreApiError(
        `A Store API respondeu com status ${response.status}.`,
        response.status,
      );
    }

    return {
      data: data as T,
      total: Number(response.headers.get("X-WP-Total")) || 0,
      totalPages:
        Number(response.headers.get("X-WP-TotalPages")) || 0,
    };
  } catch (error) {
    if (error instanceof StoreApiError) {
      throw error;
    }

    throw new StoreApiError(
      "Não foi possível consultar o catálogo do WooCommerce.",
    );
  }
}
