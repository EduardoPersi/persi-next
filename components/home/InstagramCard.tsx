import Image from "next/image";
import { Images, Play } from "lucide-react";
import type { InstagramFeedItem } from "@/types/instagram";
import { InstagramIcon } from "./InstagramIcon";

const BLUR_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiNlMmU4ZjAiLz48L3N2Zz4=";

interface InstagramCardProps {
  post: InstagramFeedItem;
}

function getPostDescription(caption?: string) {
  if (!caption) return "Post do Instagram da Persi Materiais";

  return (
    caption
      .replace(/#\S+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Post do Instagram da Persi Materiais"
  );
}

function formatInstagramDate(timestamp: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(timestamp));
}

export function InstagramCard({ post }: InstagramCardProps) {
  const description = getPostDescription(post.caption);
  const isVideo =
    post.mediaType === "VIDEO" || post.mediaType === "REELS";
  const isCarousel = post.mediaType === "CAROUSEL_ALBUM";

  return (
    <article className="h-full">
      <a
        href={post.permalink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${description}. Abrir publicação no Instagram`}
        className="group block h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <div className="relative aspect-square overflow-hidden bg-slate-100">
          <Image
            src={`/api/instagram/media/${encodeURIComponent(post.id)}`}
            alt={description}
            fill
            loading="lazy"
            placeholder="blur"
            blurDataURL={BLUR_DATA_URL}
            sizes="(min-width: 1280px) 384px, (min-width: 768px) 30vw, 46vw"
            className="object-cover transition duration-300 group-hover:scale-[1.03] group-hover:brightness-75 group-focus-visible:brightness-75"
          />

          <span className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm">
            <InstagramIcon className="h-5 w-5" />
          </span>

          {isVideo || isCarousel ? (
            <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/70 text-white">
              {isVideo ? (
                <Play className="h-5 w-5 fill-current" aria-hidden="true" />
              ) : (
                <Images className="h-5 w-5" aria-hidden="true" />
              )}
              <span className="sr-only">
                {isVideo ? "Vídeo ou Reel" : "Carrossel"}
              </span>
            </span>
          ) : null}

          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/20 text-sm font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="rounded-xl bg-slate-950/75 px-4 py-2">
              Ver publicação
            </span>
          </span>
        </div>

        <div className="p-3 sm:p-4">
          <p className="line-clamp-2 text-sm leading-5 text-foreground">
            {description}
          </p>
          <time
            dateTime={post.timestamp}
            className="mt-2 block text-xs font-medium text-muted"
          >
            {formatInstagramDate(post.timestamp)}
          </time>
        </div>
      </a>
    </article>
  );
}
