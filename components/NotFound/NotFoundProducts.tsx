import {
  getFeaturedProducts,
  getProducts,
} from "@/services/woocommerce/products";
import type { Product } from "@/types/product";
import { NotFoundProductCarousel } from "./NotFoundProductCarousel";

export async function NotFoundProducts() {
  let products: Product[] = [];

  try {
    products = await getFeaturedProducts(5);

    if (products.length === 0) {
      products = await getProducts({
        perPage: 5,
        order: "desc",
        orderby: "date",
      });
    }
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Erro ao carregar produtos da página 404:", error);
    }
  }

  return products.length > 0 ? (
    <NotFoundProductCarousel products={products} />
  ) : null;
}
