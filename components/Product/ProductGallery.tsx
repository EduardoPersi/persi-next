"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { type MouseEvent, useState } from "react";
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
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const selectedImage = galleryImages[selectedIndex] ?? galleryImages[0];
  const hasMultipleImages = galleryImages.length > 1;

  function supportsImageZoom() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function handleZoomMove(event: MouseEvent<HTMLDivElement>) {
    if (!supportsImageZoom()) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;

    setZoomOrigin({ x, y });
  }

  function handleZoomEnter() {
    if (supportsImageZoom()) setIsZoomed(true);
  }

  function handleZoomLeave() {
    setIsZoomed(false);
    setZoomOrigin({ x: 50, y: 50 });
  }

  function selectImage(index: number) {
    setSelectedIndex(index);
    handleZoomLeave();
  }

  function showPreviousImage() {
    selectImage(
      (selectedIndex - 1 + galleryImages.length) % galleryImages.length,
    );
  }

  function showNextImage() {
    selectImage((selectedIndex + 1) % galleryImages.length);
  }

  return (
    <section
      aria-label={`Galeria de imagens de ${productName}`}
      onContextMenu={(event) => event.preventDefault()}
      className="min-w-0 max-w-full"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div
          className="absolute inset-0 overflow-hidden md:cursor-zoom-in"
          onMouseEnter={handleZoomEnter}
          onMouseMove={handleZoomMove}
          onMouseLeave={handleZoomLeave}
        >
          <Image
            src={selectedImage.src}
            alt={selectedImage.alt}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            className="select-none object-contain p-6 transition-transform duration-200 ease-out sm:p-8"
            style={{
              transform: isZoomed ? "scale(1.8)" : "scale(1)",
              transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
            }}
          />
        </div>

        {hasMultipleImages ? (
          <>
            <button
              type="button"
              onClick={showPreviousImage}
              aria-label="Exibir imagem anterior"
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-[#0c2d72] shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={showNextImage}
              aria-label="Exibir próxima imagem"
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-[#0c2d72] shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 max-w-full gap-3 overflow-x-auto pb-2">
        {galleryImages.map((image, index) => {
          const isSelected = index === selectedIndex;

          return (
            <button
              key={`${image.src}-${index}`}
              type="button"
              onClick={() => selectImage(index)}
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
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                className="select-none object-contain p-2"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
