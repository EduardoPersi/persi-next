import "server-only";

import type {
  InstagramMedia,
  InstagramMediaType,
} from "@/types/instagram";
import {
  getInstagramCredentials,
  instagramGraphGet,
  InstagramApiError,
} from "./client";

const INSTAGRAM_POST_LIMIT = 10;

interface InstagramMediaResponse {
  data?: unknown;
}

interface RawInstagramMedia {
  id?: unknown;
  caption?: unknown;
  media_type?: unknown;
  media_product_type?: unknown;
  media_url?: unknown;
  thumbnail_url?: unknown;
  permalink?: unknown;
  timestamp?: unknown;
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
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

function mapInstagramMedia(value: unknown): InstagramMedia | undefined {
  if (!value || typeof value !== "object") return undefined;

  const media = value as RawInstagramMedia;
  const id = getOptionalString(media.id);
  const mediaType = getMediaType(media);
  const permalink = getOptionalString(media.permalink);
  const timestamp = getOptionalString(media.timestamp);

  if (!id || !mediaType || !permalink || !timestamp) return undefined;

  const mappedMedia: InstagramMedia = {
    id,
    mediaType,
    permalink,
    timestamp,
    caption: getOptionalString(media.caption),
    mediaUrl: getOptionalString(media.media_url),
    thumbnailUrl: getOptionalString(media.thumbnail_url),
  };
  const hasUsableImage =
    mediaType === "VIDEO" || mediaType === "REELS"
      ? Boolean(mappedMedia.thumbnailUrl)
      : Boolean(mappedMedia.mediaUrl);

  return hasUsableImage ? mappedMedia : undefined;
}

export async function getInstagramMedia(): Promise<InstagramMedia[]> {
  const credentials = getInstagramCredentials();

  if (!credentials) {
    if (process.env.NODE_ENV === "development") {
      console.info("Credenciais do Instagram ainda não configuradas.");
    }
    return [];
  }

  try {
    const response = await instagramGraphGet<InstagramMediaResponse>(
      `${credentials.userId}/media`,
      {
        fields:
          "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
        limit: String(INSTAGRAM_POST_LIMIT),
      },
    );
    const media = Array.isArray(response.data) ? response.data : [];

    return media
      .map(mapInstagramMedia)
      .filter((item): item is InstagramMedia => item !== undefined)
      .slice(0, INSTAGRAM_POST_LIMIT);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "Erro ao carregar publicações do Instagram:",
        error instanceof InstagramApiError
          ? error.message
          : "Falha de comunicação ou resposta inválida.",
      );
    }
    return [];
  }
}

export function getInstagramImageSource(
  media: InstagramMedia,
): string | undefined {
  return media.mediaType === "VIDEO" || media.mediaType === "REELS"
    ? media.thumbnailUrl
    : media.mediaUrl;
}
