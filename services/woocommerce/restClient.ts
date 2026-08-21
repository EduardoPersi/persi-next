import "server-only";
import { WooCommerceRestError } from "./restError.ts";

export { WooCommerceRestError };

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
    const startedAt = performance.now();
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

    if (process.env.WOO_REQUEST_DIAGNOSTICS === "1") {
      console.info("[woocommerce-outbound]", {
        api: "rest-v3",
        endpoint,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        attempt: 1,
        revalidate: options.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
      });
    }

    if (!response.ok) {
      // Diagnóstico temporário: nunca exposto ao cliente — só o
      // WooCommerceRestError genérico é lançado abaixo. Sem isso não dá pra
      // saber qual campo o WooCommerce rejeitou (a mensagem genérica some o
      // corpo real do erro, que costuma ter code/message explicando o motivo).
      console.error("[woocommerce-rest]", {
        endpoint,
        status: response.status,
        body: await response.json().catch(() => null),
      });
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

async function restApiWrite<T>(
  endpoint: string,
  method: "POST" | "PUT",
  body: unknown,
): Promise<T> {
  const url = getRestApiUrl(endpoint);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: getAuthorizationHeader(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof WooCommerceRestError) throw error;

    throw new WooCommerceRestError(
      "Não foi possível gravar na REST API do WooCommerce.",
    );
  }

  const parsedBody = await response.json().catch(() => null);

  if (!response.ok) {
    // Diagnóstico temporário: nunca exposto ao cliente — mesma razão do
    // restApiGetWithMeta acima.
    console.error("[woocommerce-rest]", {
      endpoint,
      method,
      status: response.status,
      body: parsedBody,
    });
    throw new WooCommerceRestError(
      `A REST API respondeu com status ${response.status}.`,
      response.status,
    );
  }

  return parsedBody as T;
}

export async function restApiPost<T>(endpoint: string, body: unknown): Promise<T> {
  return restApiWrite<T>(endpoint, "POST", body);
}

export async function restApiPut<T>(endpoint: string, body: unknown): Promise<T> {
  return restApiWrite<T>(endpoint, "PUT", body);
}
