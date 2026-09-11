import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header/Header";
import { ProductGrid } from "@/components/Category/CategoryProductsClient";
import { Container } from "@/components/UI/Container";
import { BreadcrumbBackLink } from "@/components/UI/BreadcrumbBackLink";
import { JsonLd } from "@/components/SEO/JsonLd";
import {
  DELIVERY_REGIONS,
  formatBRL,
  getDeliveryRegionBySlug,
} from "@/lib/constants/deliveryRegions";
import { STORE_INFO } from "@/lib/constants/storeInfo";
import { getCategoryHref, SITE_URL } from "@/lib/routing/storefrontUrls";
import { buildBreadcrumbListJsonLd } from "@/lib/seo/productBreadcrumb";
import { buildProductItemListJsonLd } from "@/lib/seo/structuredData";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import { getAvailabilityFirstProductsPage } from "@/services/woocommerce/products";

const PRODUCTS_PER_PAGE = 12;

export interface RegionalSegmentConfig {
  /** Slug da categoria de topo real no WooCommerce (ex: "eletrica"). */
  categorySlug: string;
  /** Rótulo do segmento (ex: "Materiais Elétricos"). */
  segmentLabel: string;
  /** Base da rota (ex: "/materiais-eletricos"). */
  routeBase: string;
  /** Frase curta descrevendo o segmento, usada na intro e na meta description. */
  productSummary: string;
  /** Subcategorias reais em destaque (label + href já existentes no catálogo). */
  featuredSubcategories: Array<{ label: string; href: string }>;
  /** O outro segmento regional (Elétrica ↔ Hidráulica), para link cruzado na mesma cidade. */
  crossSegment: { label: string; routeBase: string };
}

interface RegionalSegmentPageProps {
  params: Promise<{ cidade: string }>;
}

// Lista vazia + fallback sob demanda (mesmo padrão de app/marca/[slug]):
// gera cada página na primeira visita e cacheia via ISR, em vez de
// pré-gerar as 34 de uma vez no build — evita que uma falha pontual da
// API do WooCommerce (ou, em builds isolados, uma env var ausente)
// derrube o build inteiro por causa de uma única página.
export function createRegionalGenerateStaticParams() {
  return async function generateStaticParams() {
    return [];
  };
}

export function createRegionalGenerateMetadata(config: RegionalSegmentConfig) {
  return async function generateMetadata({
    params,
  }: RegionalSegmentPageProps): Promise<Metadata> {
    const { cidade } = await params;
    const region = getDeliveryRegionBySlug(cidade);

    if (!region) {
      return {
        title: "Região não encontrada | Persi Materiais",
        robots: { index: false, follow: false },
      };
    }

    const title = `${config.segmentLabel} em ${region.name} | Persi Materiais`;
    const description = `${config.productSummary} Entrega para ${region.name} com frete grátis em compras acima de ${formatBRL(region.freeShippingMinOrder)}.`;
    const pathname = `${config.routeBase}/${region.slug}`;

    return {
      title,
      description,
      alternates: { canonical: pathname },
      openGraph: {
        locale: "pt_BR",
        title,
        description,
        type: "website",
        url: pathname,
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  };
}

export function createRegionalSegmentPage(config: RegionalSegmentConfig) {
  return async function RegionalSegmentPage({
    params,
  }: RegionalSegmentPageProps) {
    const { cidade } = await params;
    const region = getDeliveryRegionBySlug(cidade);

    if (!region) {
      notFound();
    }

    const categories = await getAllProductCategories();
    const category = categories.find(
      (item) => item.slug === config.categorySlug,
    );

    if (!category) {
      notFound();
    }

    const productsPage = await getAvailabilityFirstProductsPage({
      category: category.id,
      perPage: PRODUCTS_PER_PAGE,
      page: 1,
      order: "desc",
      orderby: "popularity",
    });

    const pathname = `${config.routeBase}/${region.slug}`;
    const pageUrl = new URL(pathname, SITE_URL).toString();
    const categoryHref = getCategoryHref(category, categories);
    const title = `${config.segmentLabel} em ${region.name}`;
    const breadcrumbItems = [
      { label: "Home", href: "/" },
      { label: config.segmentLabel, href: categoryHref },
      { label: region.name, href: pathname, current: true },
    ];

    const serviceJsonLd = {
      "@context": "https://schema.org",
      "@type": "Service",
      name: title,
      areaServed: { "@type": "City", name: region.name },
      provider: {
        "@type": "HardwareStore",
        name: STORE_INFO.name,
        url: SITE_URL,
      },
      url: pageUrl,
    };
    const breadcrumbJsonLd = buildBreadcrumbListJsonLd(
      breadcrumbItems,
      SITE_URL,
      pathname,
    );
    const itemListJsonLd = buildProductItemListJsonLd(
      productsPage.products,
      SITE_URL,
    );

    return (
      <>
        <JsonLd data={[serviceJsonLd, breadcrumbJsonLd, itemListJsonLd]} />
        <Header />
        <main id="main-content" className="pt-2 pb-3 sm:py-6 lg:py-10">
          <Container>
            <nav aria-label="Breadcrumb" data-route-transition-skip>
              <BreadcrumbBackLink items={breadcrumbItems.slice(0, -1)} />
              <ol className="hidden items-center gap-x-2 gap-y-1 text-xs text-muted sm:flex sm:flex-wrap sm:text-sm">
                {breadcrumbItems.map((item, index) => (
                  <li key={item.href} className="flex min-w-0 items-center gap-2">
                    {index > 0 ? <span aria-hidden="true">›</span> : null}
                    {item.current ? (
                      <span className="text-foreground" aria-current="page">
                        {item.label}
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        className="tap-feedback rounded-sm px-0.5 transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-4 bg-white p-4 sm:mt-6">
              <h1 className="text-2xl font-bold text-primary">{title}</h1>
              <p className="mt-3 max-w-3xl text-sm text-muted">
                {config.productSummary} A Persi Materiais entrega em{" "}
                {region.name} saindo da nossa loja em Jundiaí, com{" "}
                <strong className="text-foreground">
                  frete grátis em compras acima de{" "}
                  {formatBRL(region.freeShippingMinOrder)}
                </strong>
                . Consulte as{" "}
                <Link
                  href="/frete-gratis-na-regiao"
                  className="underline hover:text-secondary"
                >
                  condições completas de entrega na região
                </Link>
                .
              </p>

              <p className="mt-3 max-w-3xl text-sm text-muted">
                A entrega é feita com caminhões próprios da Persi, em até três
                tentativas — se não houver ninguém pra receber, o pedido
                retorna à loja em Jundiaí. Entregas são feitas somente para
                maiores de idade. Gesso, drywall e cimento CPII/CPIII ficam de
                fora da política de frete grátis por peso e volume.
              </p>

              {config.featuredSubcategories.length > 0 ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {config.featuredSubcategories.map((sub) => (
                    <Link
                      key={sub.href}
                      href={sub.href}
                      className="tap-feedback rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      {sub.label}
                    </Link>
                  ))}
                </div>
              ) : null}

              <p className="mt-5 text-sm text-muted">
                Também precisa de{" "}
                {config.crossSegment.label.toLowerCase()} em {region.name}?{" "}
                <Link
                  href={`${config.crossSegment.routeBase}/${region.slug}`}
                  className="font-medium text-primary underline hover:text-secondary"
                >
                  Veja {config.crossSegment.label.toLowerCase()} para {region.name}
                </Link>
                .
              </p>
            </div>

            <div className="mt-6">
              {productsPage.products.length > 0 ? (
                <ProductGrid products={productsPage.products} />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                  <p className="text-sm text-muted">
                    Consulte nosso catálogo completo de {config.segmentLabel.toLowerCase()}.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-8 text-center">
              <Link
                href={categoryHref}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-secondary px-6 text-sm font-semibold text-white"
              >
                Ver catálogo completo de {config.segmentLabel}
              </Link>
            </div>

            <section
              className="mt-10 border-t border-slate-200 pt-8"
              aria-labelledby="regional-nearby-cities-title"
            >
              <h2
                id="regional-nearby-cities-title"
                className="text-lg font-bold text-primary"
              >
                Também entregamos {config.segmentLabel.toLowerCase()} em
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {DELIVERY_REGIONS.filter(
                  (other) => other.slug !== region.slug,
                ).map((other) => (
                  <Link
                    key={other.slug}
                    href={`${config.routeBase}/${other.slug}`}
                    className="tap-feedback rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-primary"
                  >
                    {other.name}
                  </Link>
                ))}
              </div>
            </section>
          </Container>
        </main>
      </>
    );
  };
}
