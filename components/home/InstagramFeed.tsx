import { getInstagramMedia } from "@/lib/social/instagram";
import type { InstagramFeedItem } from "@/types/instagram";
import { InstagramCarousel } from "./InstagramCarousel";
import { InstagramIcon } from "./InstagramIcon";

const INSTAGRAM_PROFILE_URL =
  "https://www.instagram.com/persimateriais/";

export async function InstagramFeed() {
  const media = await getInstagramMedia();
  if (media.length === 0) return null;

  const posts: InstagramFeedItem[] = media.map(
    ({ id, caption, mediaType, permalink, timestamp }) => ({
      id,
      caption,
      mediaType,
      permalink,
      timestamp,
    }),
  );

  return (
    <section className="mt-12" aria-labelledby="instagram-feed-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="instagram-feed-title"
            className="text-xl font-bold text-foreground sm:text-2xl"
          >
            Siga a Persi no Instagram
          </h2>
          <p className="mt-1 text-sm text-muted sm:text-base">
            Novidades, lançamentos, instalações e dicas para sua obra.
          </p>
        </div>

        <a
          href={INSTAGRAM_PROFILE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ver perfil completo da Persi Materiais no Instagram"
          className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl border border-primary px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <InstagramIcon className="h-5 w-5" />
          Ver perfil completo
        </a>
      </div>

      <InstagramCarousel posts={posts} />
    </section>
  );
}
