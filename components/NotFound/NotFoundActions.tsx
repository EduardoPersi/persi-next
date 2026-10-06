"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, House } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { LinkWhatsApp } from "@/components/UI/LinkWhatsApp";
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
  // Era um <button> que abria `window.open`; virou link de verdade (o mesmo
  // visual do Button), para o clique passar pelo componente único de WhatsApp.
  return (
    <LinkWhatsApp
      posicao="pagina_404"
      fallbackHref={WHATSAPP_URL}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-2 text-base font-medium text-white transition-colors hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 active:bg-secondary-hover bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-700 sm:w-auto"
      aria-label="Falar com a Persi Materiais no WhatsApp"
    >
      <WhatsAppIcon className="h-5 w-5" aria-hidden="true" />
      Falar no WhatsApp
    </LinkWhatsApp>
  );
}
