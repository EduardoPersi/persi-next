"use client";

import { useState } from "react";
import Image from "next/image";
import type { ProductImage } from "@/types/product";

interface ProductGalleryProps {
  images: ProductImage[];
  productName: string;
}

const fallbackImage: ProductImage = {
  src: "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp",
  alt: "Imagem demonstrativa da Persi Materiais",
};

export function ProductGallery({
  images,
  productName,
}: ProductGalleryProps) {
  const galleryImages = images.length > 0 ? images : [fallbackImage];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedImage = galleryImages[selectedIndex] ?? galleryImages[0];

  return (
    <section aria-label={`Galeria de imagens de ${productName}`}>
      <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
        <Image
          src={selectedImage.src}
          alt={selectedImage.alt}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-contain p-6 sm:p-8"
        />
      </div>

      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {galleryImages.map((image, index) => {
          const isSelected = index === selectedIndex;

          return (
            <button
              key={`${image.src}-${index}`}
              type="button"
              onClick={() => setSelectedIndex(index)}
              aria-label={`Exibir imagem ${index + 1} de ${productName}`}
              aria-pressed={isSelected}
              className={`relative aspect-square w-20 shrink-0 overflow-hidden rounded-xl border bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-[#0c2d72]"
                  : "border-slate-200 hover:border-slate-400"
              }`}
            >
              <Image
                src={image.src}
                alt=""
                fill
                sizes="80px"
                className="object-contain p-2"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
