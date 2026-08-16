import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { getCategoryHref, SITE_URL } from "@/lib/routing/storefrontUrls";
import { getAllProductCategories } from "@/services/woocommerce/categories";

// URLs antigas eram sempre /categoria/:slug (um único segmento), com
// subcategoria opcionalmente indicada via ?subcategoria=. A URL canônica
// atual é "achatada" (ex: /esgoto/conexoes-esgoto), então a resolução
// precisa consultar a árvore de categorias em tempo de request.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await params;
  const slug = segments.at(-1);
  const categories = await getAllProductCategories({ hideEmpty: false }).catch(
    () => [],
  );
  const category = categories.find((item) => item.slug === slug);

  if (!category) {
    notFound();
  }

  const subcategoriaSlug = new URL(request.url).searchParams.get(
    "subcategoria",
  );
  const target =
    (subcategoriaSlug &&
      categories.find((item) => item.slug === subcategoriaSlug)) ||
    category;

  const destination = getCategoryHref(target, categories);

  // Guarda estrutural: getCategoryHref nunca deveria apontar de volta para
  // /categoria/*, mas se algum dia existir uma categoria com slug literal
  // "categoria" essa checagem evita um loop de redirecionamento.
  if (destination === "/categoria" || destination.startsWith("/categoria/")) {
    notFound();
  }

  return NextResponse.redirect(new URL(destination, SITE_URL), 301);
}
