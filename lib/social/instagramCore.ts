import type {
  InstagramMedia,
  InstagramMediaType,
} from "@/types/instagram";

export const INSTAGRAM_POST_LIMIT = 6;

interface InstagramMediaResponse {
  data?: unknown;
}

interface RawInstagramMedia {
  id?: unknown;
  caption?: unknown;
  media_type?: unknown;
  media_product_type?: unknown;
  media_url?: unknown;
  permalink?: unknown;
  thumbnail_url?: unknown;
  timestamp?: unknown;
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function getHttpsUrl(value: unknown) {
  const candidate = getOptionalString(value);
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function getMediaType(media: RawInstagramMedia): InstagramMediaType | undefined {
  const mediaType = getOptionalString(media.media_type);
  const productType = getOptionalString(media.media_product_type);

  if (productType === "REELS") return "REELS";
  if (
    mediaType === "IMAGE" ||
    mediaType === "VIDEO" ||
    mediaType === "CAROUSEL_ALBUM"
  ) {
    return mediaType;
  }

  return undefined;
}

function normalizeMedia(value: unknown): InstagramMedia | undefined {
  if (!value || typeof value !== "object") return undefined;

  const media = value as RawInstagramMedia;
  const id = getOptionalString(media.id);
  const mediaType = getMediaType(media);
  const permalink = getHttpsUrl(media.permalink);
  const timestamp = getOptionalString(media.timestamp);
  const mediaUrl = getHttpsUrl(media.media_url);
  const thumbnailUrl = getHttpsUrl(media.thumbnail_url);

  if (
    !id ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
    !mediaType ||
    !permalink ||
    !timestamp ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    return undefined;
  }

  const normalized: InstagramMedia = {
    id,
    mediaType,
    permalink,
    timestamp,
    caption: getOptionalString(media.caption),
    mediaUrl,
    thumbnailUrl,
  };
  const hasImage =
    mediaType === "VIDEO" || mediaType === "REELS"
      ? Boolean(thumbnailUrl)
      : Boolean(mediaUrl);

  return hasImage ? normalized : undefined;
}

export function normalizeInstagramResponse(
  value: unknown,
): InstagramMedia[] {
  if (!value || typeof value !== "object") return [];

  const response = value as InstagramMediaResponse;
  if (!Array.isArray(response.data)) return [];

  return response.data
    .map(normalizeMedia)
    .filter((media): media is InstagramMedia => media !== undefined)
    .slice(0, INSTAGRAM_POST_LIMIT);
}

export function getInstagramImageSource(
  media: InstagramMedia,
): string | undefined {
  return media.mediaType === "VIDEO" || media.mediaType === "REELS"
    ? media.thumbnailUrl
    : media.mediaUrl;
}
