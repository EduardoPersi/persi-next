"use client";

import { ReactNode, useEffect, useRef } from "react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  widthClassName?: string;
  titleId?: string;
  children: ReactNode;
};

export function Drawer({
  open,
  onClose,
  side = "right",
  widthClassName = "max-w-[360px]",
  titleId,
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement;
    const previousOverflow = document.body.style.overflow;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusableElements = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    if (open) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => {
        const initialFocus =
          panelRef.current?.querySelector<HTMLElement>(
            "[data-drawer-initial-focus]",
          ) ?? panelRef.current;
        initialFocus?.focus();
      });
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (
        open &&
        previouslyFocusedElement instanceof HTMLElement &&
        document.contains(previouslyFocusedElement)
      ) {
        previouslyFocusedElement.focus();
      }
    };
  }, [open, onClose]);

  const closedPosition =
    side === "left" ? "-translate-x-full" : "translate-x-full";

  return (
    <>
      <button
        type="button"
        aria-label="Fechar painel"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        className={`fixed top-0 z-50 h-screen h-[100dvh] w-full bg-white shadow-2xl transition-transform duration-300 ease-out ${
          side === "left" ? "left-0" : "right-0"
        } ${widthClassName} ${open ? "translate-x-0" : closedPosition}`}
      >
        {children}
      </aside>
    </>
  );
}
