import { NextResponse } from "next/server";
import { getProductBySlug } from "@/services/woocommerce/products";

interface ProductDetailsRouteProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function GET(
  _request: Request,
  { params }: ProductDetailsRouteProps,
) {
  const { slug } = await params;

  if (
    !slug ||
    slug.length > 160 ||
    !/^[a-z0-9-]+$/i.test(slug)
  ) {
    return NextResponse.json(
      { message: "Produto inválido." },
      { status: 400 },
    );
  }

  try {
    const product = await getProductBySlug(slug);

    if (!product) {
      return NextResponse.json(
        { message: "Produto não encontrado." },
        { status: 404 },
      );
    }

    return NextResponse.json({ product });
  } catch {
    return NextResponse.json(
      { message: "Não foi possível carregar os detalhes deste produto." },
      { status: 502 },
    );
  }
}
