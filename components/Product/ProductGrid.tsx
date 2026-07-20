import {
  getFeaturedProducts,
  getProducts,
} from "@/services/woocommerce/products";
import type { Product } from "@/types/product";
import { ProductCard } from "./ProductCard";

export async function ProductGrid() {
  let products: Product[] = [];
  let hasLoadError = false;

  try {
    products = await getFeaturedProducts(4);

    if (products.length === 0) {
      products = await getProducts({
        perPage: 4,
        order: "desc",
        orderby: "date",
      });
    }
  } catch (error) {
    hasLoadError = true;

    if (process.env.NODE_ENV === "development") {
      console.error("Erro ao carregar produtos da Store API:", error);
    }
  }

  if (hasLoadError) {
    return (
      <p
        className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600"
        role="status"
      >
        Não foi possível carregar os produtos neste momento.
      </p>
    );
  }

  if (products.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Nenhum produto foi encontrado neste momento.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          name={product.name}
          image={product.image?.src ?? ""}
          images={product.images}
          href={`/produto/${product.slug}`}
          price={product.price}
          regularPrice={
            product.onSale ? product.regularPrice : undefined
          }
          currencyCode={product.currencyCode}
          commercialText={product.commercialText}
          brand={product.brands[0]?.name}
          badge={product.onSale ? "Oferta" : undefined}
          available={product.available}
          productId={product.id}
          productSlug={product.slug}
        />
      ))}
    </div>
  );
}
