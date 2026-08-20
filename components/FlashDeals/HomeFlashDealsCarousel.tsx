"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

const AUTOPLAY_DELAY_MS = 3000;
const INTERACTION_PAUSE_MS = 5000;

export function HomeFlashDealsCarousel({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const resumeTimerRef = useRef<number | undefined>(undefined);
  const pausedRef = useRef(false);
  const items = Children.toArray(children);
  const loopItems = [...items, ...items].map((child, index) =>
    isValidElement(child)
      ? cloneElement(child as ReactElement, { key: `flash-deal-${index}` })
      : child,
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track || items.length < 2) return;

    const advance = () => {
      if (pausedRef.current) return;
      const firstCard = track.firstElementChild as HTMLElement | null;
      if (!firstCard) return;
      const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
      const step = firstCard.offsetWidth + gap;
      const loopPoint = track.scrollWidth / 2;
      if (track.scrollLeft >= loopPoint - step / 2) {
        track.scrollTo({ left: 0, behavior: "auto" });
      }
      track.scrollBy({ left: step, behavior: "smooth" });
    };

    const interval = window.setInterval(advance, AUTOPLAY_DELAY_MS);
    return () => window.clearInterval(interval);
  }, [items.length]);

  function pauseForInteraction() {
    pausedRef.current = true;
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      const track = trackRef.current;
      if (track && track.scrollLeft >= track.scrollWidth / 2) {
        track.scrollTo({ left: track.scrollLeft - track.scrollWidth / 2, behavior: "auto" });
      }
      pausedRef.current = false;
    }, INTERACTION_PAUSE_MS);
  }

  useEffect(
    () => () => {
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    },
    [],
  );

  return (
    <div
      ref={trackRef}
      className="-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
      role="list"
      aria-label="Produtos em oferta relâmpago"
      onPointerDown={pauseForInteraction}
      onTouchStart={pauseForInteraction}
      onWheel={pauseForInteraction}
      onKeyDown={pauseForInteraction}
    >
      {loopItems.map((item, index) => (
        <div key={index} className="w-[calc((100vw-3.5rem)/2)] shrink-0 snap-start">
          {item}
        </div>
      ))}
    </div>
  );
}
