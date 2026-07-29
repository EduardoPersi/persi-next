"use client";

import { useEffect, useRef, type RefObject } from "react";

interface UseClickOutsideOptions {
  isOpen: boolean;
  refs: ReadonlyArray<RefObject<HTMLElement | null>>;
  onOutside: (event: PointerEvent) => void;
  ignoreRefs?: ReadonlyArray<RefObject<HTMLElement | null>>;
  ignoreSelectors?: ReadonlyArray<string>;
}

function eventIsInside(
  event: PointerEvent,
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
) {
  const path = event.composedPath();
  return refs.some((ref) => {
    const element = ref.current;
    return Boolean(
      element &&
        (path.includes(element) ||
          (event.target instanceof Node && element.contains(event.target))),
    );
  });
}

export function useClickOutside({
  isOpen,
  refs,
  onOutside,
  ignoreRefs = [],
  ignoreSelectors = [],
}: UseClickOutsideOptions) {
  const onOutsideRef = useRef(onOutside);
  const refsRef = useRef(refs);
  const ignoreRefsRef = useRef(ignoreRefs);
  const ignoreSelectorsRef = useRef(ignoreSelectors);

  useEffect(() => {
    onOutsideRef.current = onOutside;
    refsRef.current = refs;
    ignoreRefsRef.current = ignoreRefs;
    ignoreSelectorsRef.current = ignoreSelectors;
  }, [ignoreRefs, ignoreSelectors, onOutside, refs]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        eventIsInside(event, refsRef.current) ||
        eventIsInside(event, ignoreRefsRef.current)
      ) {
        return;
      }

      if (
        event.target instanceof Element &&
        ignoreSelectorsRef.current.some((selector) =>
          event.target instanceof Element
            ? event.target.closest(selector)
            : false,
        )
      ) {
        return;
      }

      onOutsideRef.current(event);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isOpen]);
}
