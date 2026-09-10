import { NextResponse } from "next/server";
import { buildProductOptionsFromParams } from "@/lib/commerce/categoryFilters";
import { getBrandByIdentifier } from "@/services/woocommerce/brands";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import {
  getAvailabilityFirstProductsPage,
  type GetProductsOptions,
} from "@/services/woocommerce/products";

const PRODUCTS_PER_PAGE = 16;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const categorySlug = url.searchParams.get("categoria");

  if (!categorySlug) {
    return NextResponse.json(
      { error: "Parâmetro 'categoria' é obrigatório." },
      { status: 400 },
    );
  }

  const categories = await getAllProductCategories();
  const category = categories.find((item) => item.slug === categorySlug);

  if (!category) {
    return NextResponse.json(
      { error: "Categoria não encontrada." },
      { status: 404 },
    );
  }

  const brandIdentifier = url.searchParams.get("marca") ?? undefined;
  const selectedBrand = brandIdentifier
    ? await getBrandByIdentifier(brandIdentifier).catch(() => undefined)
    : undefined;
  const page = getPositiveIntegerOrDefault(url.searchParams.get("pagina"), 1);

  const productOptions: GetProductsOptions = {
    ...buildProductOptionsFromParams({
      categoryId: category.id,
      searchParams: url.searchParams,
      brandIdentifier: selectedBrand ? brandIdentifier : undefined,
      perPage: PRODUCTS_PER_PAGE,
    }),
    page,
  };

  const productsPage = await getAvailabilityFirstProductsPage(productOptions);

  return NextResponse.json({
    products: productsPage.products,
    total: productsPage.total,
    totalPages: productsPage.totalPages,
    page,
    brand: selectedBrand
      ? { name: selectedBrand.name, slug: selectedBrand.slug }
      : null,
  });
}

function getPositiveIntegerOrDefault(value: string | null, fallback: number) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
