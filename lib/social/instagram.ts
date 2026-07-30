import "server-only";

import { unstable_cache } from "next/cache";
import type { InstagramMedia } from "@/types/instagram";
import {
  INSTAGRAM_POST_LIMIT,
  normalizeInstagramResponse,
} from "./instagramCore";

const INSTAGRAM_GRAPH_API_URL = "https://graph.facebook.com/v23.0";
export const INSTAGRAM_REVALIDATE_SECONDS = 60 * 60;
const INSTAGRAM_REQUEST_TIMEOUT_MS = 10_000;
const INSTAGRAM_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_product_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
].join(",");

let lastSuccessfulMedia: InstagramMedia[] = [];

interface InstagramCredentials {
  accessToken: string;
  businessAccountId: string;
}

function logInstagramEnvironmentStatus() {
  const appIdLoaded = Boolean(process.env.INSTAGRAM_APP_ID?.trim());
  const appSecretLoaded = Boolean(
    process.env.INSTAGRAM_APP_SECRET?.trim(),
  );
  const accessTokenLoaded = Boolean(
    process.env.INSTAGRAM_ACCESS_TOKEN?.trim(),
  );
  const businessAccountIdLoaded = Boolean(
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim(),
  );

  console.info(
    `INSTAGRAM_ENV_STATUS appIdLoaded=${appIdLoaded} appSecretLoaded=${appSecretLoaded} accessTokenLoaded=${accessTokenLoaded} businessAccountIdLoaded=${businessAccountIdLoaded}`,
  );
}

function getInstagramCredentials(): InstagramCredentials | undefined {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const businessAccountId =
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();

  if (!accessToken || !businessAccountId) return undefined;
  return { accessToken, businessAccountId };
}

function logInstagramFailure(code: string) {
  console.error(`INSTAGRAM_FEED_FETCH_FAILED code=${code}`);
}

async function requestInstagramMedia(): Promise<InstagramMedia[]> {
  const credentials = getInstagramCredentials();
  if (!credentials) return [];

  console.info("INSTAGRAM_FETCH_STARTED");

  const url = new URL(
    `${INSTAGRAM_GRAPH_API_URL}/${encodeURIComponent(credentials.businessAccountId)}/media`,
  );
  url.searchParams.set("fields", INSTAGRAM_FIELDS);
  url.searchParams.set("limit", String(INSTAGRAM_POST_LIMIT));
  url.searchParams.set("access_token", credentials.accessToken);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(INSTAGRAM_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GRAPH_API_${response.status}`);
  }

  const media = normalizeInstagramResponse(await response.json());
  console.info("INSTAGRAM_GRAPH_API_SUCCESS");
  console.info(`INSTAGRAM_POSTS_RETURNED count=${media.length}`);
  return media;
}

const getCachedInstagramMedia = unstable_cache(
  requestInstagramMedia,
  ["persi-instagram-feed-v1"],
  {
    revalidate: INSTAGRAM_REVALIDATE_SECONDS,
    tags: ["instagram-feed"],
  },
);

export async function getInstagramMedia(): Promise<InstagramMedia[]> {
  logInstagramEnvironmentStatus();

  if (!getInstagramCredentials()) {
    logInstagramFailure("MISSING_REQUIRED_ENV");
    return [];
  }

  try {
    const media = await getCachedInstagramMedia();
    lastSuccessfulMedia = media;
    console.info(`INSTAGRAM_CACHE_RESULT count=${media.length}`);
    return media;
  } catch (error) {
    const code =
      error instanceof Error && /^GRAPH_API_\d{3}$/.test(error.message)
        ? error.message
        : error instanceof DOMException && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "UNAVAILABLE";

    logInstagramFailure(code);
    return [...lastSuccessfulMedia];
  }
}

export {
  getInstagramImageSource,
} from "./instagramCore";
