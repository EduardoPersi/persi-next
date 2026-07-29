"use client";

import { A11y, Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import { ProductCard } from "@/components/Product/ProductCard";
import type { Product } from "@/types/product";
import "swiper/css";
import "swiper/css/navigation";

export function NotFoundProductCarousel({
  products,
}: {
  products: Product[];
}) {
  if (products.length === 0) return null;

  return (
    <Swiper
      modules={[Navigation, A11y]}
      slidesPerView={2}
      spaceBetween={16}
      watchOverflow
      breakpoints={{
        768: { slidesPerView: 4, spaceBetween: 20 },
        1280: { slidesPerView: 5, spaceBetween: 24 },
      }}
      className="mt-5"
      aria-label="Produtos mais vendidos"
    >
      {products.map((product) => (
        <SwiperSlide key={product.id} className="h-auto!">
          <ProductCard
            name={product.name}
            image={product.image?.src ?? ""}
            images={product.images}
            href={`/produto/${product.slug}`}
            price={product.price}
            regularPrice={product.onSale ? product.regularPrice : undefined}
            currencyCode={product.currencyCode}
            commercialText={product.commercialText}
            brand={product.brands[0]?.name}
            badge={product.onSale ? "Oferta" : undefined}
            available={product.available}
            productId={product.id}
            productSlug={product.slug}
          />
        </SwiperSlide>
      ))}
    </Swiper>
  );
}
