"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { WhatsAppIcon } from "@/components/UI/SocialIcons";
import { useClickOutside } from "@/hooks/useClickOutside";

const HIDDEN_PREFIXES = ["/checkout", "/carrinho"];
const WHATSAPP_NUMBER = "551139648294";
const GREETING_MESSAGE = "Olá! Preciso de ajuda para encontrar um produto.";

export function WhatsAppFloatingButton() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside({
    isOpen,
    refs: [containerRef],
    onOutside: () => setIsOpen(false),
  });

  const isHidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (isHidden) return null;

  const isPreviewVisible = isOpen || isHovering;
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(GREETING_MESSAGE)}`;
  const timestamp = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  function handleToggle() {
    setIsOpen((previous) => !previous);
    setHasOpened(true);
  }

  return (
    <div
      ref={containerRef}
      className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-3 sm:right-6"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {isPreviewVisible ? (
        <div
          role="dialog"
          aria-label="Conversa com a Persi Materiais pelo WhatsApp"
          className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between bg-[#075E54] px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- ícone estático de 32px, otimização do next/image é desnecessária */}
                <img
                  src="/favicon.ico"
                  alt=""
                  className="h-full w-full object-cover"
                />
              </span>
              <span className="font-semibold">Persi</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Fechar conversa"
              className="rounded-full p-1 hover:bg-white/10"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="bg-[#ECE5DD] px-4 py-4">
            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow">
              <p className="text-sm text-slate-800">
                Olá, precisa de ajuda? Mande um zap para nossa equipe de
                vendas!
              </p>
              <span className="mt-1 block text-right text-[11px] text-slate-400">
                {timestamp}
              </span>
            </div>
          </div>
          <div className="p-3">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1fb958]"
            >
              <WhatsAppIcon className="h-5 w-5" aria-hidden="true" />
              Falar no WhatsApp
            </a>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleToggle}
        aria-label="Falar com a Persi Materiais pelo WhatsApp"
        aria-expanded={isPreviewVisible}
        className="group relative flex h-[70px] w-[70px] items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
      >
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25D366] opacity-0 group-hover:opacity-75"
          aria-hidden="true"
        />
        <WhatsAppIcon className="relative h-[35px] w-[35px]" aria-hidden="true" />
        {!hasOpened ? (
          <span
            className="absolute -right-1 -top-1 h-[17.5px] w-[17.5px] rounded-full border-2 border-white bg-red-500"
            aria-hidden="true"
          />
        ) : null}
      </button>
    </div>
  );
}
