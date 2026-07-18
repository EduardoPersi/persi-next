"use client";

import { ReactNode, useEffect } from "react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  widthClassName?: string;
  children: ReactNode;
};

export function Drawer({
  open,
  onClose,
  side = "right",
  widthClassName = "max-w-[360px]",
  children,
}: DrawerProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    if (open) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
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
        aria-hidden={!open}
        className={`fixed top-0 z-50 h-screen w-full bg-white shadow-2xl transition-transform duration-300 ease-out ${
          side === "left" ? "left-0" : "right-0"
        } ${widthClassName} ${open ? "translate-x-0" : closedPosition}`}
      >
        {children}
      </aside>
    </>
  );
}
