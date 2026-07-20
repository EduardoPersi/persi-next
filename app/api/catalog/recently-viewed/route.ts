import { NextRequest, NextResponse } from "next/server";
import { getProducts } from "@/services/woocommerce/products";

const MAX_RECENT_PRODUCTS = 10;
const MAX_SLUG_LENGTH = 160;
const VALID_SLUG_PATTERN = /^[a-z0-9-]+$/i;

function parseSlugs(value: string | null) {
  if (!value) return [];

  return [...new Set(value.split(","))]
    .map((slug) => slug.trim())
    .filter(
      (slug) =>
        slug.length > 0 &&
        slug.length <= MAX_SLUG_LENGTH &&
        VALID_SLUG_PATTERN.test(slug),
    )
    .slice(0, MAX_RECENT_PRODUCTS);
}

export async function GET(request: NextRequest) {
  const slugs = parseSlugs(request.nextUrl.searchParams.get("slugs"));

  if (slugs.length === 0) {
    return NextResponse.json({ products: [] });
  }

  try {
    const products = await getProducts({
      slug: slugs.join(","),
      perPage: slugs.length,
    });

    return NextResponse.json({
      products: products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        image: product.image
          ? {
              src: product.image.src,
              alt: product.image.alt || product.name,
            }
          : undefined,
        price: product.price,
        regularPrice: product.regularPrice,
        pixPrice: product.pixPrice,
        currencyCode: product.currencyCode,
        commercialText: product.commercialText,
      })),
    });
  } catch {
    return NextResponse.json(
      { message: "Não foi possível carregar os produtos recentes." },
      { status: 502 },
    );
  }
}
