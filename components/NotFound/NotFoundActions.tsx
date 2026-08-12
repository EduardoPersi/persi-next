"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, House } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { WhatsAppIcon } from "@/components/UI/SocialIcons";
import { useRouteTransition } from "@/hooks/useRouteTransition";

const WHATSAPP_URL =
  "https://wa.me/551139648294?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20para%20encontrar%20um%20produto.";

export function NotFoundNavigationActions() {
  const router = useRouter();
  const { navigate } = useRouteTransition();

  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      <Button
        size="lg"
        className="w-full"
        onClick={() => navigate("/")}
        aria-label="Voltar para a Página Inicial"
      >
        <House className="h-5 w-5" aria-hidden="true" />
        Voltar para a Página Inicial
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="w-full"
        onClick={() => router.back()}
        aria-label="Voltar para a página anterior"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        Voltar para a página anterior
      </Button>
    </div>
  );
}

export function NotFoundWhatsAppAction() {
  function openWhatsApp() {
    window.open(WHATSAPP_URL, "_blank", "noopener,noreferrer");
  }

  return (
    <Button
      className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-700 sm:w-auto"
      onClick={openWhatsApp}
      aria-label="Falar com a Persi Materiais no WhatsApp"
    >
      <WhatsAppIcon className="h-5 w-5" aria-hidden="true" />
      Falar no WhatsApp
    </Button>
  );
}
