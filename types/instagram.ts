export type InstagramMediaType =
  | "IMAGE"
  | "VIDEO"
  | "REELS"
  | "CAROUSEL_ALBUM";

export interface InstagramMedia {
  id: string;
  caption?: string;
  mediaType: InstagramMediaType;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink: string;
  timestamp: string;
}

export type InstagramFeedItem = Pick<
  InstagramMedia,
  "id" | "caption" | "mediaType" | "permalink" | "timestamp"
>;
