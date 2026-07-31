import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header/Header";
import { ProductCard } from "@/components/Product/ProductCard";
import { ProductDetails } from "@/components/Product/ProductDetails";
import { ProductGallery } from "@/components/Product/ProductGallery";
import { ProductAdjacentNavigation } from "@/components/Product/ProductAdjacentNavigation";
import { ProductPurchasePanel } from "@/components/Product/ProductPurchasePanel";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { RecentlyViewedTracker } from "@/components/Product/RecentlyViewedTracker";
import { Container } from "@/components/UI/Container";
import {
  buildBreadcrumbListJsonLd,
  buildProductCategoryBreadcrumb,
} from "@/lib/seo/productBreadcrumb";
import {
  getProductHref,
  SITE_URL,
} from "@/lib/routing/storefrontUrls";
import { getBrandBySlug } from "@/services/woocommerce/brands";
import { getBoughtTogether } from "@/services/woocommerce/boughtTogether";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import { getProductFamily } from "@/services/woocommerce/productFamilies";
import { getProductNavigation } from "@/services/woocommerce/productNavigation";
import {
  getProductBySlug,
  getProducts,
  getProductsByCategory,
} from "@/services/woocommerce/products";
import type { Product } from "@/types/product";
import { getStockNotificationEndpoint } from "@/services/woocommerce/stockNotifications";

interface ProductPageProps {
  params: Promise<{
    slug: string;
  }>;
}

async function getRelatedProducts(product: Product): Promise<Product[]> {
  try {
    const categoryId = product.categories[0]?.id;
    const products =
      categoryId !== undefined
        ? await getProductsByCategory(categoryId, { perPage: 5 })
        : await getProducts({ perPage: 5 });

    return products
      .filter((relatedProduct) => relatedProduct.id !== product.id)
      .slice(0, 4);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Erro ao carregar produtos relacionados:", error);
    }

    return [];
  }
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const product = await getProductBySlug(slug);

    if (!product) {
      return {
        title: "Produto não encontrado | Persi Materiais",
        robots: { index: false, follow: false },
      };
    }

    const description =
      product.shortDescription ||
      `Confira ${product.name} na Persi Materiais. Consulte preço, disponibilidade e entrega para Jundiaí e região.`;

    return {
      title: `${product.name} | Persi Materiais`,
      description,
      alternates: {
        canonical: getProductHref(product.slug),
      },
      openGraph: {
        title: `${product.name} | Persi Materiais`,
        description,
        type: "website",
        url: getProductHref(product.slug),
        images: product.image
          ? [
              {
                url: product.image.src,
                alt: product.image.alt || product.name,
              },
            ]
          : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: `${product.name} | Persi Materiais`,
        description,
        images: product.image ? [product.image.src] : undefined,
      },
    };
  } catch {
    return {
      title: "Produto | Persi Materiais",
      robots: { index: false, follow: false },
    };
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  let product: Product | undefined;

  try {
    product = await getProductBySlug(slug);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Erro ao carregar produto da Store API:", error);
    }
  }

  if (!product) {
    notFound();
  }

  const [relatedProducts, brand, boughtTogether, productFamily, categories] = await Promise.all([
    getRelatedProducts(product),
    product.brands[0]?.slug
      ? getBrandBySlug(product.brands[0].slug).catch(() => undefined)
      : Promise.resolve(undefined),
    getBoughtTogether({
      productId: product.id,
      productSlug: product.slug,
    }).catch(() => []),
    getProductFamily(product.id).catch(() => undefined),
    getAllProductCategories({ hideEmpty: false }).catch((error) => {
      if (process.env.NODE_ENV === "development") {
        console.error("Erro ao carregar a hierarquia de categorias:", error);
      }
      return [];
    }),
  ]);
  const breadcrumbItems = buildProductCategoryBreadcrumb({
    productName: product.name,
    productCategoryIds: product.categories.map((category) => category.id),
    categories,
  });
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd(
    breadcrumbItems,
    SITE_URL,
    getProductHref(product.slug),
  );
  const productUrl = new URL(getProductHref(product.slug), SITE_URL).toString();
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url: productUrl,
    image: product.images.map((image) => image.src),
    description: product.shortDescription || product.description,
    sku: product.sku || undefined,
    brand: product.brands[0]
      ? { "@type": "Brand", name: product.brands[0].name }
      : undefined,
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: product.currencyCode,
      price: product.price,
      availability: product.available
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    },
    aggregateRating:
      product.reviewCount > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: product.averageRating,
            reviewCount: product.reviewCount,
          }
        : undefined,
  };
  const productNavigation = await getProductNavigation({
    product,
    categories,
    family: productFamily,
  }).catch((error) => {
    if (process.env.NODE_ENV === "development") {
      console.error("Erro ao carregar a navegação entre produtos:", error);
    }
    return undefined;
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <Header />
      <RecentlyViewedTracker slug={product.slug} />
      <main className="pb-6 pt-3 sm:pb-8 sm:pt-4 lg:pb-10 lg:pt-5">
        <Container>
          <div className="flex min-w-0 items-center justify-between gap-4">
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 sm:text-sm">
              <li>
                <Link
                  href="/"
                  className="rounded-sm hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                >
                  Home
                </Link>
              </li>
              {breadcrumbItems.slice(1, -1).map((item) => (
                <li
                  key={item.href}
                  className="flex min-w-0 items-center gap-2"
                >
                  <span aria-hidden="true">›</span>
                  <Link
                    href={item.href ?? "/"}
                    className="rounded-sm hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li
                className="flex min-w-0 items-center gap-2 text-slate-800"
                aria-current="page"
              >
                <span aria-hidden="true">›</span>
                <span>{product.name}</span>
              </li>
              </ol>
            </nav>
            {productNavigation ? (
              <ProductAdjacentNavigation data={productNavigation} />
            ) : null}
          </div>

          <div className="mt-4 grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
              <ProductGallery
                images={product.images}
                productName={product.name}
              />
            </div>
            <div className="min-w-0">
              <ProductPurchasePanel
                product={product}
                brand={brand}
                boughtTogetherItems={boughtTogether}
                productFamily={productFamily}
                stockNotificationEnabled={Boolean(getStockNotificationEndpoint())}
              />
            </div>
          </div>

          <ProductDetails product={product} />

          <RecentlyViewedProducts
            title="Quem viu, viu também"
            excludeSlug={product.slug}
            sectionId="customers-also-viewed-title"
          />

          {relatedProducts.length > 0 ? (
            <section
              className="mt-14"
              aria-labelledby="related-products-title"
            >
              <h2
                id="related-products-title"
                className="text-2xl font-bold text-[#0c2d72]"
              >
                Produtos relacionados
              </h2>
              <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
                {relatedProducts.map((relatedProduct) => (
                  <ProductCard
                    key={relatedProduct.id}
                    name={relatedProduct.name}
                    image={relatedProduct.image?.src ?? ""}
                    images={relatedProduct.images}
                    href={getProductHref(relatedProduct.slug)}
                    price={relatedProduct.price}
                    regularPrice={
                      relatedProduct.onSale
                        ? relatedProduct.regularPrice
                        : undefined
                    }
                    currencyCode={relatedProduct.currencyCode}
                    commercialText={relatedProduct.commercialText}
                    brand={relatedProduct.brands[0]?.name}
                    badge={relatedProduct.onSale ? "Oferta" : undefined}
                    available={relatedProduct.available}
                    productId={relatedProduct.id}
                    productSlug={relatedProduct.slug}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </Container>
      </main>
    </>
  );
}
