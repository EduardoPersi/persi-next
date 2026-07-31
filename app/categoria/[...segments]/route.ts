import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  findCategoryByPath,
  getCategoryHref,
} from "@/lib/routing/storefrontUrls";
import { getAllProductCategories } from "@/services/woocommerce/categories";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await params;
  const categories = await getAllProductCategories({ hideEmpty: false }).catch(
    () => [],
  );
  const requestedCategory =
    findCategoryByPath(segments, categories) ??
    categories.find((item) => item.slug === segments.at(-1));
  const legacySubcategorySlug =
    request.nextUrl.searchParams.get("subcategoria");
  const category = legacySubcategorySlug
    ? categories.find((item) => item.slug === legacySubcategorySlug) ??
      requestedCategory
    : requestedCategory;

  if (!category) {
    return new NextResponse("Categoria não encontrada.", { status: 404 });
  }

  const destination = request.nextUrl.clone();
  destination.pathname = getCategoryHref(category, categories);
  destination.searchParams.delete("subcategoria");
  return NextResponse.redirect(destination, 301);
}
