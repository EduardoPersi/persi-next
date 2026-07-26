"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useRef,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
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
  const touchStartX = useRef<number | null>(null);
  const selectedIndexRef = useRef(selectedIndex);
  const onIndexChangeRef = useRef(onIndexChange);
  const onCloseRef = useRef(onClose);
  const hasMultipleImages = images.length > 1;

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    onIndexChangeRef.current = onIndexChange;
    onCloseRef.current = onClose;
  }, [onClose, onIndexChange, selectedIndex]);

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
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
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
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar galeria"
        className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:right-6 sm:top-6"
      >
        <X className="h-6 w-6" aria-hidden="true" />
      </button>

      <div className="relative h-[calc(100dvh-7rem)] w-full max-w-6xl">
        <Image
          src={currentImage.src}
          alt={currentImage.alt || productName}
          fill
          sizes="100vw"
          className="select-none object-contain"
          draggable={false}
        />
      </div>

      {hasMultipleImages ? (
        <>
          <button
            type="button"
            onClick={showPrevious}
            aria-label="Imagem anterior"
            className="absolute left-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-6"
          >
            <ChevronLeft className="h-7 w-7" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={showNext}
            aria-label="Próxima imagem"
            className="absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6"
          >
            <ChevronRight className="h-7 w-7" aria-hidden="true" />
          </button>
        </>
      ) : null}

      <p
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white"
        aria-live="polite"
      >
        {selectedIndex + 1} de {images.length}
      </p>
    </div>,
    document.body,
  );
}
