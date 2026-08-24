import "server-only";

const INSTAGRAM_GRAPH_API_URL =
  "https://graph.facebook.com/v23.0";
export const INSTAGRAM_REVALIDATE_SECONDS = 30 * 60;

export class InstagramApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramApiError";
  }
}

interface InstagramCredentials {
  accessToken: string;
  userId: string;
}

export function getInstagramCredentials():
  | InstagramCredentials
  | undefined {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const userId = process.env.INSTAGRAM_USER_ID?.trim();

  if (!accessToken || !userId) return undefined;
  return { accessToken, userId };
}

export async function instagramGraphGet<T>(
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const credentials = getInstagramCredentials();
  if (!credentials) {
    throw new InstagramApiError(
      "Credenciais do Instagram ainda não configuradas.",
    );
  }

  const url = new URL(
    `${INSTAGRAM_GRAPH_API_URL}/${path.replace(/^\/+/, "")}`,
  );
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  url.searchParams.set("access_token", credentials.accessToken);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: INSTAGRAM_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new InstagramApiError(
      "A API do Instagram não respondeu com sucesso.",
    );
  }

  return (await response.json()) as T;
}
