import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  BrandProductsFallback,
  BrandProductsInteractive,
} from "@/components/Brand/BrandProductsClient";
import { Header } from "@/components/Header/Header";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { Container } from "@/components/UI/Container";
import { WordPressContent } from "@/components/UI/WordPressContent";
import { BreadcrumbBackLink } from "@/components/UI/BreadcrumbBackLink";
import { JsonLd } from "@/components/SEO/JsonLd";
import { getBrandBySlug } from "@/services/woocommerce/brands";
import { getAvailabilityFirstProductsPage } from "@/services/woocommerce/products";
import { SITE_URL } from "@/lib/routing/storefrontUrls";
import { buildBreadcrumbListJsonLd } from "@/lib/seo/productBreadcrumb";
import {
  buildCollectionPageJsonLd,
  buildProductItemListJsonLd,
} from "@/lib/seo/structuredData";

interface BrandPageProps {
  params: Promise<{ slug: string }>;
}

const PRODUCTS_PER_PAGE = 16;

// Lista vazia + fallback sob demanda: gera cada página de marca na primeira
// visita e cacheia (ISR), em vez de pré-gerar todas no build — evita
// sobrecarregar a API do WooCommerce com centenas de chamadas de uma vez.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const brand = await getBrandBySlug(slug);

    if (!brand) {
      return {
        title: "Marca não encontrada | Persi Materiais",
        robots: { index: false, follow: false },
      };
    }

    const description =
      brand.description.slice(0, 160) ||
      `Encontre produtos ${brand.name} na Persi Materiais, com entrega para Jundiaí e região.`;
    const pathname = `/marca/${brand.slug}`;

    return {
      title: `${brand.name} | Persi Materiais`,
      description,
      alternates: { canonical: pathname },
      openGraph: {
        locale: "pt_BR",
        title: `${brand.name} | Persi Materiais`,
        description,
        type: "website",
        url: pathname,
        images: brand.image
          ? [{ url: brand.image.src, alt: brand.image.alt || brand.name }]
          : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: `${brand.name} | Persi Materiais`,
        description,
        images: brand.image ? [brand.image.src] : undefined,
      },
    };
  } catch {
    return {
      title: "Marca | Persi Materiais",
      robots: { index: false, follow: false },
    };
  }
}

export default async function BrandPage({ params }: BrandPageProps) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);

  if (!brand) {
    notFound();
  }

  const firstProductsPage = await getAvailabilityFirstProductsPage({
    brand: brand.id,
    perPage: PRODUCTS_PER_PAGE,
    page: 1,
    order: "desc",
    orderby: "date",
  });

  const pathname = `/marca/${brand.slug}`;
  const brandUrl = new URL(pathname, SITE_URL).toString();
  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: brand.name, href: pathname, current: true },
  ];
  const brandJsonLd = buildCollectionPageJsonLd({
    name: brand.name,
    description: brand.description,
    url: brandUrl,
    image: brand.image?.src,
    brand: { name: brand.name },
  });
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd(
    breadcrumbItems,
    SITE_URL,
    pathname,
  );
  const itemListJsonLd = buildProductItemListJsonLd(
    firstProductsPage.products,
    SITE_URL,
  );

  return (
    <>
      <JsonLd data={[brandJsonLd, breadcrumbJsonLd, itemListJsonLd]} />
      <Header />
      <main id="main-content" className="pt-2 pb-3 sm:py-6 lg:py-10">
        <Container>
          <nav aria-label="Breadcrumb" data-route-transition-skip>
            <BreadcrumbBackLink
              items={breadcrumbItems.slice(0, -1)}
            />
            <ol className="hidden items-center gap-x-2 gap-y-1 text-xs text-muted sm:flex sm:flex-wrap sm:text-sm">
              <li>
                <Link
                  href="/"
                  className="tap-feedback rounded-sm px-0.5 transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Home
                </Link>
              </li>
              <li className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true">›</span>
                <span className="text-foreground" aria-current="page">
                  {brand.name}
                </span>
              </li>
            </ol>
          </nav>

          <div className="mt-4 flex flex-col items-center gap-4 bg-white p-6 text-center sm:mt-6">
            {brand.image ? (
              <Image
                src={brand.image.src}
                alt={brand.image.alt || `Logo da marca ${brand.name}`}
                width={200}
                height={100}
                className="h-auto max-h-24 w-auto max-w-[200px] object-contain"
                priority
              />
            ) : null}
            <h1 className="text-2xl font-bold text-primary">{brand.name}</h1>
          </div>

          <Suspense
            fallback={
              <BrandProductsFallback
                initialProducts={firstProductsPage.products}
                initialTotal={firstProductsPage.total}
              />
            }
          >
            <BrandProductsInteractive
              brandSlug={brand.slug}
              pathname={pathname}
              initialProducts={firstProductsPage.products}
              initialTotal={firstProductsPage.total}
            />
          </Suspense>

          {brand.descriptionHtml ? (
            <section
              className="mt-10 border-t border-slate-200 pt-8"
              aria-labelledby="brand-description-title"
            >
              <h2
                id="brand-description-title"
                className="text-xl font-bold text-primary"
              >
                Sobre {brand.name}
              </h2>
              <WordPressContent
                html={brand.descriptionHtml}
                variant="storefront"
                className="mt-4"
              />
            </section>
          ) : null}

          <RecentlyViewedProducts />
        </Container>
      </main>
    </>
  );
}
