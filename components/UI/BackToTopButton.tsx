"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useCookieConsent } from "@/hooks/useCookieConsent";

const VISIBILITY_THRESHOLD = 400;

export function BackToTopButton() {
  const [isVisible, setIsVisible] = useState(false);
  const { bannerVisible } = useCookieConsent();

  useEffect(() => {
    function updateVisibility() {
      setIsVisible(window.scrollY > VISIBILITY_THRESHOLD);
    }

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });

    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  function scrollToTop() {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Voltar ao topo"
      aria-hidden={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      className={`fixed left-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all hover:bg-primary-hover hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 md:left-8 ${
        bannerVisible ? "bottom-40" : "bottom-20"
      } ${
        isVisible
          ? "translate-y-0 opacity-80"
          : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
