import "server-only";

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

  try {
    const response = await fetch(
      new URL(`/wp-json/persi/v1/${path.replace(/^\/+/, "")}`, wordpressUrl),
      {
        headers: { Accept: "application/json" },
        next: { revalidate },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
