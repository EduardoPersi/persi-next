import { NextResponse } from "next/server";
import { getOrderOptions } from "@/lib/commerce/categoryFilters";
import { getBrandBySlug } from "@/services/woocommerce/brands";
import {
  getAvailabilityFirstProductsPage,
  type GetProductsOptions,
} from "@/services/woocommerce/products";

const PRODUCTS_PER_PAGE = 16;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const brandSlug = url.searchParams.get("marca");

  if (!brandSlug) {
    return NextResponse.json(
      { error: "Parâmetro 'marca' é obrigatório." },
      { status: 400 },
    );
  }

  const brand = await getBrandBySlug(brandSlug);

  if (!brand) {
    return NextResponse.json({ error: "Marca não encontrada." }, { status: 404 });
  }

  const page = getPositiveIntegerOrDefault(url.searchParams.get("pagina"), 1);
  const orderOptions = getOrderOptions(url.searchParams.get("ordem") ?? "recentes");

  const productOptions: GetProductsOptions = {
    brand: brand.id,
    perPage: PRODUCTS_PER_PAGE,
    page,
    ...orderOptions,
  };

  const productsPage = await getAvailabilityFirstProductsPage(productOptions);

  return NextResponse.json({
    products: productsPage.products,
    total: productsPage.total,
    page,
  });
}

function getPositiveIntegerOrDefault(value: string | null, fallback: number) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
