"use client";

import { X } from "lucide-react";

type AccountDrawerHeaderProps = {
  title: string;
  titleId: string;
  onClose: () => void;
};

export function AccountDrawerHeader({
  title,
  titleId,
  onClose,
}: AccountDrawerHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
      <h2 id={titleId} className="text-xl font-bold text-[#071f5c]">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        data-drawer-initial-focus
        aria-label="Fechar painel de acesso"
        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
      >
        <X size={21} aria-hidden="true" />
        <span>Fechar</span>
      </button>
    </header>
  );
}
