"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { IconButton } from "@/components/UI/IconButton";

interface HeroBannerControlsProps { slideCount: number; }
const AUTOPLAY_DELAY = 6000;

export function HeroBannerControls({ slideCount }: HeroBannerControlsProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const currentSlideRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showSlide = useCallback((nextIndex: number) => {
    const root = controlsRef.current?.closest<HTMLElement>("[data-hero-banner]");
    if (!root) return;
    const slides = root.querySelectorAll<HTMLElement>("[data-hero-slide]");
    const dots = root.querySelectorAll<HTMLButtonElement>("[data-hero-dot]");
    const normalizedIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const isActive = index === normalizedIndex;
      slide.hidden = !isActive;
      slide.setAttribute("aria-hidden", String(!isActive));
    });
    dots.forEach((dot, index) => {
      const isActive = index === normalizedIndex;
      dot.setAttribute("aria-current", isActive ? "true" : "false");
      dot.classList.toggle("w-7", isActive);
      dot.classList.toggle("bg-secondary", isActive);
      dot.classList.toggle("w-2.5", !isActive);
      dot.classList.toggle("bg-white/70", !isActive);
    });
    currentSlideRef.current = normalizedIndex;
  }, []);

  const stopAutoplay = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const startAutoplay = useCallback(() => {
    stopAutoplay();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timerRef.current = setInterval(() => showSlide(currentSlideRef.current + 1), AUTOPLAY_DELAY);
  }, [showSlide, stopAutoplay]);

  useEffect(() => {
    const root = controlsRef.current?.closest<HTMLElement>("[data-hero-banner]");
    if (!root) return;
    root.addEventListener("mouseenter", stopAutoplay);
    root.addEventListener("mouseleave", startAutoplay);
    root.addEventListener("focusin", stopAutoplay);
    root.addEventListener("focusout", startAutoplay);
    startAutoplay();
    return () => {
      stopAutoplay();
      root.removeEventListener("mouseenter", stopAutoplay);
      root.removeEventListener("mouseleave", startAutoplay);
      root.removeEventListener("focusin", stopAutoplay);
      root.removeEventListener("focusout", startAutoplay);
    };
  }, [startAutoplay, stopAutoplay]);

  return (
    <div ref={controlsRef}>
      <IconButton variant="inverse" aria-label="Slide anterior" onClick={() => showSlide(currentSlideRef.current - 1)} className="absolute left-2 top-1/2 z-10 -translate-y-1/2 focus-visible:ring-offset-2 sm:left-4">
        <ChevronLeft className="h-8 w-8 drop-shadow-[0_1px_4px_rgba(0,0,0,0.65)]" aria-hidden="true" />
      </IconButton>
      <IconButton variant="inverse" aria-label="Próximo slide" onClick={() => showSlide(currentSlideRef.current + 1)} className="absolute right-2 top-1/2 z-10 -translate-y-1/2 focus-visible:ring-offset-2 sm:right-4">
        <ChevronRight className="h-8 w-8 drop-shadow-[0_1px_4px_rgba(0,0,0,0.65)]" aria-hidden="true" />
      </IconButton>
      <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-2">
        {Array.from({ length: slideCount }, (_, index) => (
          <button key={index} type="button" data-hero-dot aria-label={`Ir para o slide ${index + 1}`} aria-current={index === 0 ? "true" : "false"} onClick={() => showSlide(index)} className={`h-2.5 rounded-full transition-[width,background-color] ${index === 0 ? "w-7 bg-secondary" : "w-2.5 bg-white/70"}`} />
        ))}
      </div>
    </div>
  );
}
