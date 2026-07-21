import "server-only";

const REST_API_PATH = "/wp-json/wc/v3";
const DEFAULT_REVALIDATE_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 10_000;

type QueryValue = string | number | boolean | undefined;

interface RestApiOptions {
  query?: Record<string, QueryValue>;
  revalidate?: number;
}

export interface RestApiResponse<T> {
  data: T;
  total: number;
  totalPages: number;
}

export class WooCommerceRestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WooCommerceRestError";
  }
}

function getRestApiUrl(
  endpoint: string,
  query: Record<string, QueryValue> = {},
) {
  const wordpressUrl = process.env.WORDPRESS_URL;

  if (!wordpressUrl) {
    throw new WooCommerceRestError("WORDPRESS_URL não está configurada.");
  }

  const url = new URL(
    `${REST_API_PATH}/${endpoint.replace(/^\/+/, "")}`,
    wordpressUrl,
  );

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });

  return url;
}

function getAuthorizationHeader() {
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new WooCommerceRestError(
      "As credenciais privadas do WooCommerce não estão configuradas.",
    );
  }

  return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`;
}

export async function restApiGetWithMeta<T>(
  endpoint: string,
  options: RestApiOptions = {},
): Promise<RestApiResponse<T>> {
  const url = getRestApiUrl(endpoint, options.query);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: getAuthorizationHeader(),
      },
      next: {
        revalidate: options.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new WooCommerceRestError(
        `A REST API respondeu com status ${response.status}.`,
        response.status,
      );
    }

    return {
      data: (await response.json()) as T,
      total: Number(response.headers.get("X-WP-Total")) || 0,
      totalPages: Number(response.headers.get("X-WP-TotalPages")) || 0,
    };
  } catch (error) {
    if (error instanceof WooCommerceRestError) throw error;

    throw new WooCommerceRestError(
      "Não foi possível consultar a REST API do WooCommerce.",
    );
  }
}
