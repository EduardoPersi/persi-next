import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header/Header";
import { ProductCard } from "@/components/Product/ProductCard";
import { ProductDetails } from "@/components/Product/ProductDetails";
import { ProductGallery } from "@/components/Product/ProductGallery";
import { ProductPurchasePanel } from "@/components/Product/ProductPurchasePanel";
import { RecentlyViewedTracker } from "@/components/Product/RecentlyViewedTracker";
import { Container } from "@/components/UI/Container";
import { getBrandBySlug } from "@/services/woocommerce/brands";
import {
  getProductBySlug,
  getProducts,
  getProductsByCategory,
} from "@/services/woocommerce/products";
import type { Product } from "@/types/product";

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
        canonical: `/produto/${product.slug}`,
      },
      openGraph: {
        title: `${product.name} | Persi Materiais`,
        description,
        type: "website",
        images: product.image
          ? [
              {
                url: product.image.src,
                alt: product.image.alt || product.name,
              },
            ]
          : undefined,
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

  const [relatedProducts, brand] = await Promise.all([
    getRelatedProducts(product),
    product.brands[0]?.slug
      ? getBrandBySlug(product.brands[0].slug).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  return (
    <>
      <Header />
      <RecentlyViewedTracker slug={product.slug} />
      <main className="pb-6 pt-3 sm:pb-8 sm:pt-4 lg:pb-10 lg:pt-5">
        <Container>
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 sm:text-sm">
              <li>
                <Link
                  href="/"
                  className="rounded-sm hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                >
                  Home
                </Link>
              </li>
              {product.categories.map((category) => (
                <li
                  key={category.id}
                  className="flex min-w-0 items-center gap-2"
                >
                  <span aria-hidden="true">›</span>
                  <Link
                    href={`/categoria/${category.slug}`}
                    className="rounded-sm hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                  >
                    {category.name}
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

          <div className="mt-4 grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-12">
            <ProductGallery
              images={product.images}
              productName={product.name}
            />
            <ProductPurchasePanel
              product={product}
              brand={brand}
              stockNotificationEnabled={Boolean(
                process.env.WORDPRESS_STOCK_NOTIFICATION_ENDPOINT,
              )}
            />
          </div>

          <ProductDetails product={product} />

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
                    href={`/produto/${relatedProduct.slug}`}
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
