import Image from "next/image";
import Link from "next/link";
import { getPostHref } from "@/lib/routing/storefrontUrls";
import { getLatestBlogPosts } from "@/services/wordpress/posts";
import type { BlogPost } from "@/types/blogPost";

const POST_FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

function formatPostDate(dateIso: string): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function BlogPostCard({ post }: { post: BlogPost }) {
  const metaLine = [post.categories.slice(0, 2).join(", "), formatPostDate(post.date)]
    .filter(Boolean)
    .join(" / ");

  return (
    <Link
      href={getPostHref(post.slug)}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition duration-200 hover:-translate-y-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100">
        <Image
          src={post.image?.src || POST_FALLBACK_IMAGE}
          alt={post.image?.alt || post.title}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-200 group-hover:scale-105"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
          {post.author.avatarUrl ? (
            <Image
              src={post.author.avatarUrl}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 shrink-0 rounded-full border border-white/70"
            />
          ) : null}
          <span className="truncate text-xs font-medium text-white">
            {post.author.name}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {metaLine ? (
          <p className="text-xs font-medium text-muted">{metaLine}</p>
        ) : null}
        <h3 className="mt-1.5 line-clamp-2 text-base font-bold leading-5 text-foreground">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-5 text-muted">
          {post.excerpt}
        </p>
        <span className="mt-3 text-sm font-semibold text-secondary group-hover:underline">
          Continuar lendo
        </span>
      </div>
    </Link>
  );
}

export async function ExpertAdviceSection() {
  const posts = await getLatestBlogPosts(3).catch(() => []);
  if (posts.length === 0) return null;

  return (
    <section aria-labelledby="expert-advice-title" className="mt-12">
      <h2
        id="expert-advice-title"
        className="text-xl font-bold text-primary sm:text-2xl"
      >
        Conselhos de especialistas
      </h2>

      <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <BlogPostCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
