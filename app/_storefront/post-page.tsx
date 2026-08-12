import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header/Header";
import { Container } from "@/components/UI/Container";
import { WordPressContent } from "@/components/UI/WordPressContent";
import { getPostHref, SITE_URL } from "@/lib/routing/storefrontUrls";
import { getBlogPostBySlug } from "@/services/wordpress/posts";

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

function formatPostDate(dateIso: string): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export async function generateMetadata({
  params,
}: PostPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const post = await getBlogPostBySlug(slug);
    if (!post) {
      return {
        title: "Conteúdo não encontrado | Persi Materiais",
        robots: { index: false, follow: false },
      };
    }

    const description = post.excerpt || `${post.title} — Persi Materiais.`;

    return {
      title: `${post.title} | Persi Materiais`,
      description,
      alternates: { canonical: getPostHref(post.slug) },
      openGraph: {
        title: post.title,
        description,
        type: "article",
        url: getPostHref(post.slug),
        images: post.image
          ? [{ url: post.image.src, alt: post.image.alt || post.title }]
          : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: post.title,
        description,
        images: post.image ? [post.image.src] : undefined,
      },
    };
  } catch {
    return {
      title: "Conselhos de especialistas | Persi Materiais",
      robots: { index: false, follow: false },
    };
  }
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) notFound();

  const postUrl = new URL(getPostHref(post.slug), SITE_URL).toString();
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    image: post.image ? [post.image.src] : undefined,
    datePublished: post.date,
    author: { "@type": "Person", name: post.author.name },
    publisher: { "@type": "Organization", name: "Persi Materiais" },
    mainEntityOfPage: postUrl,
  };
  const metaLine = [post.categories.slice(0, 2).join(", "), formatPostDate(post.date)]
    .filter(Boolean)
    .join(" / ");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <Header />
      <main className="py-5 sm:py-8 lg:py-10">
        <Container size="md">
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 sm:text-sm">
              <li>
                <Link href="/" className="hover:text-[#ff6a00]">
                  Início
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="truncate text-slate-800">
                {post.title}
              </li>
            </ol>
          </nav>

          <article className="rounded-md border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8 sm:py-8">
            {metaLine ? (
              <p className="text-sm font-medium text-slate-500">{metaLine}</p>
            ) : null}

            <h1 className="mt-1.5 text-2xl font-bold text-[#071f5c] sm:text-3xl">
              {post.title}
            </h1>

            <div className="mt-3 flex items-center gap-2">
              {post.author.avatarUrl ? (
                <Image
                  src={post.author.avatarUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 rounded-full"
                />
              ) : null}
              <span className="text-sm text-slate-600">
                Por {post.author.name}
              </span>
            </div>

            {post.image ? (
              <div className="relative mt-6 aspect-[16/9] w-full overflow-hidden rounded-lg bg-slate-100">
                <Image
                  src={post.image.src}
                  alt={post.image.alt || post.title}
                  fill
                  sizes="(min-width: 1024px) 768px, 100vw"
                  priority
                  className="object-cover"
                />
              </div>
            ) : null}

            <WordPressContent html={post.contentHtml} className="mt-7" />
          </article>

          <p className="mt-6">
            <Link
              href="/"
              className="text-sm font-semibold text-[#ff6a00] hover:underline"
            >
              ← Voltar para a Home
            </Link>
          </p>
        </Container>
      </main>
    </>
  );
}
