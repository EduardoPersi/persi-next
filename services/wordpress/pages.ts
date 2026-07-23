import type { InstitutionalPage } from "@/types/wordpress";

const WORDPRESS_PAGES_PATH = "/wp-json/wp/v2/pages";
const DEFAULT_REVALIDATE_SECONDS = 3600;

interface WordPressRenderedValue {
  rendered?: unknown;
}

interface WordPressPageResponse {
  id?: unknown;
  slug?: unknown;
  title?: WordPressRenderedValue;
  content?: WordPressRenderedValue;
  excerpt?: WordPressRenderedValue;
  modified?: unknown;
}

function getRenderedString(value: WordPressRenderedValue | undefined) {
  return typeof value?.rendered === "string" ? value.rendered : "";
}

function sanitizeWordPressHtml(html: string) {
  return html
    .replace(
      /<(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)\b[^>]*\/?>/gi,
      "",
    )
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:style|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2/gi,
      "",
    )
    .replace(/<h1(\s[^>]*)?>/gi, "<h2$1>")
    .replace(/<\/h1>/gi, "</h2>");
}

function normalizeHeadingText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function removeRepeatedPageTitle(html: string, title: string) {
  const normalizedTitle = normalizeHeadingText(title);
  let removed = false;

  return html.replace(
    /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (heading, _level: string, content: string) => {
      if (!removed && normalizeHeadingText(content) === normalizedTitle) {
        removed = true;
        return "";
      }

      return heading;
    },
  );
}

function isWordPressPageResponse(
  value: unknown,
): value is WordPressPageResponse {
  return typeof value === "object" && value !== null;
}

export async function getWordPressPageBySlug(
  slug: string,
): Promise<InstitutionalPage | null> {
  const wordpressUrl = process.env.WORDPRESS_URL;
  if (!wordpressUrl) return null;

  const url = new URL(WORDPRESS_PAGES_PATH, wordpressUrl);
  url.searchParams.set("slug", slug);
  url.searchParams.set(
    "_fields",
    "id,slug,title,content,excerpt,modified",
  );

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: DEFAULT_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || !isWordPressPageResponse(payload[0])) {
      return null;
    }

    const page = payload[0];
    if (
      typeof page.id !== "number" ||
      typeof page.slug !== "string" ||
      typeof page.modified !== "string"
    ) {
      return null;
    }

    const title = getRenderedString(page.title);
    const content = removeRepeatedPageTitle(
      sanitizeWordPressHtml(getRenderedString(page.content)),
      title,
    );
    if (!title || !content) return null;

    return {
      id: page.id,
      slug: page.slug,
      title,
      content,
      excerpt: sanitizeWordPressHtml(getRenderedString(page.excerpt)),
      modified: page.modified,
    };
  } catch {
    return null;
  }
}
