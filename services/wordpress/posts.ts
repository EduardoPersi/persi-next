import "server-only";
import { sanitizeWordPressHtml } from "@/lib/formatting/sanitizeWordPressHtml";
import { isTransientHttpStatus, withSingleRetry } from "@/lib/network/retry";
import { stripHtml } from "@/services/woocommerce/mappers";
import type { BlogPost, BlogPostDetail } from "@/types/blogPost";

const REQUEST_TIMEOUT_MS = 5_000;

interface WordPressEmbeddedTerm {
  name: string;
  taxonomy: string;
}

interface WordPressEmbeddedAuthor {
  name: string;
  avatar_urls?: Record<string, string>;
}

interface WordPressEmbeddedMedia {
  source_url?: string;
  alt_text?: string;
}

interface WordPressPostResponse {
  id: number;
  slug: string;
  link: string;
  date: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
  _embedded?: {
    author?: WordPressEmbeddedAuthor[];
    "wp:featuredmedia"?: WordPressEmbeddedMedia[];
    "wp:term"?: WordPressEmbeddedTerm[][];
  };
}

function isWordPressPost(value: unknown): value is WordPressPostResponse {
  if (!value || typeof value !== "object") return false;

  const post = value as Partial<WordPressPostResponse>;
  return (
    typeof post.id === "number" &&
    typeof post.slug === "string" &&
    typeof post.link === "string" &&
    typeof post.date === "string" &&
    typeof post.title?.rendered === "string" &&
    typeof post.excerpt?.rendered === "string"
  );
}

function mapPost(post: WordPressPostResponse): BlogPost {
  const featuredMedia = post._embedded?.["wp:featuredmedia"]?.[0];
  const author = post._embedded?.author?.[0];
  const categories = (post._embedded?.["wp:term"] ?? [])
    .flat()
    .filter((term) => term.taxonomy === "category")
    .map((term) => stripHtml(term.name));

  return {
    id: post.id,
    slug: post.slug,
    link: post.link,
    title: stripHtml(post.title.rendered),
    excerpt: stripHtml(post.excerpt.rendered),
    date: post.date,
    image: featuredMedia?.source_url
      ? {
          src: featuredMedia.source_url,
          alt: stripHtml(featuredMedia.alt_text || ""),
        }
      : undefined,
    author: {
      name: author?.name ? stripHtml(author.name) : "Persi Materiais",
      avatarUrl: author?.avatar_urls?.["48"],
    },
    categories,
  };
}

function mapPostDetail(post: WordPressPostResponse): BlogPostDetail {
  return {
    ...mapPost(post),
    contentHtml: sanitizeWordPressHtml(post.content?.rendered ?? ""),
  };
}

export async function getLatestBlogPosts(limit = 3): Promise<BlogPost[]> {
  const wordpressUrl = process.env.WORDPRESS_URL;
  if (!wordpressUrl) return [];

  try {
    const url = new URL(`/wp-json/wp/v2/posts?per_page=${limit}&_embed=1`, wordpressUrl);
    const response = await withSingleRetry(
      () =>
        fetch(url, {
          headers: { Accept: "application/json" },
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      {
        shouldRetryResult: (result) => isTransientHttpStatus(result.status),
        onRetry: (reason) => {
          console.warn("[wordpress-posts-retry]", { reason });
        },
      },
    );
    if (!response.ok) return [];

    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];

    return data.filter(isWordPressPost).map(mapPost);
  } catch {
    return [];
  }
}

export async function getBlogPostBySlug(
  slug: string,
): Promise<BlogPostDetail | undefined> {
  const wordpressUrl = process.env.WORDPRESS_URL;
  if (!wordpressUrl) return undefined;

  try {
    const url = new URL(
      `/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=1`,
      wordpressUrl,
    );
    const response = await withSingleRetry(
      () =>
        fetch(url, {
          headers: { Accept: "application/json" },
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      {
        shouldRetryResult: (result) => isTransientHttpStatus(result.status),
        onRetry: (reason) => {
          console.warn("[wordpress-posts-retry]", { slug, reason });
        },
      },
    );
    if (!response.ok) return undefined;

    const data: unknown = await response.json();
    if (!Array.isArray(data)) return undefined;

    const post = data.filter(isWordPressPost)[0];
    return post ? mapPostDetail(post) : undefined;
  } catch {
    return undefined;
  }
}
