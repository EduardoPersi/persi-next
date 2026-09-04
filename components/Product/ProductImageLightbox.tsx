"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useRef,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useOverlayManager } from "@/hooks/useOverlayManager";
import type { ProductImage } from "@/types/product";

interface ProductImageLightboxProps {
  images: ProductImage[];
  selectedIndex: number;
  productName: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export function ProductImageLightbox({
  images,
  selectedIndex,
  productName,
  onIndexChange,
  onClose,
}: ProductImageLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const selectedIndexRef = useRef(selectedIndex);
  const onIndexChangeRef = useRef(onIndexChange);
  const hasMultipleImages = images.length > 1;

  useOverlayManager({
    id: "product-image-lightbox",
    isOpen: true,
    onClose,
  });
  useClickOutside({
    isOpen: true,
    refs: [imageRef],
    onOutside: onClose,
    ignoreSelectors: ["[data-lightbox-control]"],
  });

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange, selectedIndex]);

  function showPrevious() {
    onIndexChange(
      (selectedIndex - 1 + images.length) % images.length,
    );
  }

  function showNext() {
    onIndexChange((selectedIndex + 1) % images.length);
  }

  function handleTouchStart(event: TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent) {
    const startX = touchStartX.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (startX === null || endX === undefined) return;

    const distance = endX - startX;
    if (Math.abs(distance) < 50) return;
    if (distance > 0) showPrevious();
    else showNext();
  }

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft" && hasMultipleImages) {
        event.preventDefault();
        onIndexChangeRef.current(
          (selectedIndexRef.current - 1 + images.length) % images.length,
        );
        return;
      }
      if (event.key === "ArrowRight" && hasMultipleImages) {
        event.preventDefault();
        onIndexChangeRef.current(
          (selectedIndexRef.current + 1) % images.length,
        );
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [hasMultipleImages, images.length]);

  const currentImage = images[selectedIndex] ?? images[0];
  if (!currentImage) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Galeria de imagens do produto"
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 p-3 outline-none sm:p-6"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        ref={imageRef}
        className="relative flex h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:h-[calc(100dvh-3rem)]"
      >
        <button
          data-lightbox-control
          type="button"
          onClick={onClose}
          aria-label="Fechar galeria"
          className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white text-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>

        <div className="relative min-h-0 flex-1">
          <Image
            src={currentImage.src}
            alt={currentImage.alt || productName}
            fill
            sizes="(min-width: 1024px) 60vw, 100vw"
            className="select-none object-contain p-14 sm:p-16"
            draggable={false}
          />

          {hasMultipleImages ? (
            <>
              <button
                data-lightbox-control
                type="button"
                onClick={showPrevious}
                aria-label="Imagem anterior"
                className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </button>
              <button
                data-lightbox-control
                type="button"
                onClick={showNext}
                aria-label="Próxima imagem"
                className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>

        {hasMultipleImages ? (
          <div className="shrink-0 border-t border-slate-200 bg-white">
            <p
              className="px-4 pb-3 pt-2 text-center text-xs font-medium text-slate-500 sm:pb-0"
              aria-live="polite"
            >
              {selectedIndex + 1} de {images.length}
            </p>
            <div
              className="hidden items-center gap-2 overflow-x-auto px-4 pb-3 pt-2 sm:flex"
              onTouchStart={(event) => event.stopPropagation()}
              onTouchEnd={(event) => event.stopPropagation()}
            >
              {images.map((image, index) => {
                const isSelected = index === selectedIndex;

                return (
                  <button
                    key={`${image.src}-${index}`}
                    data-lightbox-control
                    type="button"
                    onClick={() => onIndexChange(index)}
                    aria-label={`Exibir imagem ${index + 1} de ${productName}`}
                    aria-pressed={isSelected}
                    className={`relative aspect-square w-14 shrink-0 overflow-hidden rounded-lg border-2 bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:w-16 ${
                      isSelected
                        ? "border-primary"
                        : "border-transparent hover:border-slate-300"
                    }`}
                  >
                    <Image
                      src={image.src}
                      alt=""
                      fill
                      sizes="64px"
                      draggable={false}
                      className="select-none object-contain p-1"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
