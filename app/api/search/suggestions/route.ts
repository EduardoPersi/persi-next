import { NextResponse } from "next/server";
import { searchWooCommerceProducts } from "@/services/woocommerce/search";
import type {
  ProductSearchSuggestion,
  ProductSearchSuggestionsResponse,
} from "@/types/search";

const MINIMUM_QUERY_LENGTH = 3;
const MAXIMUM_QUERY_LENGTH = 100;
const SUGGESTIONS_LIMIT = 6;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (
    query.length < MINIMUM_QUERY_LENGTH ||
    query.length > MAXIMUM_QUERY_LENGTH
  ) {
    return NextResponse.json(
      { message: "Informe ao menos 3 caracteres para pesquisar." },
      { status: 400 },
    );
  }

  try {
    const products = await searchWooCommerceProducts(query, {
      limit: SUGGESTIONS_LIMIT,
    });
    const suggestions: ProductSearchSuggestion[] = products.map(
      (product) => ({
        id: product.id,
        name: product.name,
        slug: product.slug,
        image: product.image
          ? { src: product.image.src, alt: product.image.alt }
          : undefined,
        price: product.price,
        currencyCode: product.currencyCode,
        available: product.available,
      }),
    );
    const response: ProductSearchSuggestionsResponse = {
      products: suggestions,
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { message: "Não foi possível pesquisar agora." },
      { status: 502 },
    );
  }
}
