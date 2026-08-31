import "server-only";
import { isTransientHttpStatus, withSingleRetry } from "@/lib/network/retry";

const REQUEST_TIMEOUT_MS = 5_000;

export class PersiHeadlessError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "PersiHeadlessError";
  }
}

export async function persiHeadlessGet<T>(
  path: string,
  revalidate = 60,
): Promise<T> {
  const wordpressUrl = process.env.WORDPRESS_URL;
  if (!wordpressUrl) throw new PersiHeadlessError("WORDPRESS_URL não configurada.");

  const url = new URL(`/wp-json/persi/v1/${path.replace(/^\/+/, "")}`, wordpressUrl);

  try {
    const response = await withSingleRetry(
      () =>
        fetch(url, {
          headers: { Accept: "application/json" },
          next: { revalidate },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      {
        shouldRetryResult: (result) => isTransientHttpStatus(result.status),
        onRetry: (reason) => {
          console.warn("[persi-headless-retry]", { path, reason });
        },
      },
    );
    if (!response.ok) {
      throw new PersiHeadlessError("Persi Headless indisponível.", response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof PersiHeadlessError) throw error;
    throw new PersiHeadlessError("Persi Headless indisponível.");
  }
}
