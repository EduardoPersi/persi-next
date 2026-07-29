"use client";

import { useRouter } from "next/navigation";
import { Grid3X3, House, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { WhatsAppIcon } from "@/components/UI/SocialIcons";

const WHATSAPP_URL =
  "https://wa.me/551139648294?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20para%20encontrar%20um%20produto.";

export function NotFoundNavigationActions() {
  const router = useRouter();

  return (
    <nav
      className="grid w-full gap-3 sm:grid-cols-3"
      aria-label="Opções para continuar navegando"
    >
      <Button
        size="lg"
        className="w-full"
        onClick={() => router.push("/")}
        aria-label="Voltar para a página inicial"
      >
        <House className="h-5 w-5" aria-hidden="true" />
        Voltar para a página inicial
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="w-full"
        onClick={() => router.push("/categorias")}
        aria-label="Ver todas as categorias"
      >
        <Grid3X3 className="h-5 w-5" aria-hidden="true" />
        Ver todas as categorias
      </Button>
      <Button
        size="lg"
        variant="ghost"
        className="w-full"
        onClick={() => router.push("/minha-conta")}
        aria-label="Entrar na Minha Conta"
      >
        <UserRound className="h-5 w-5" aria-hidden="true" />
        Entrar na Minha Conta
      </Button>
    </nav>
  );
}

export function NotFoundHelpActions() {
  function openWhatsApp() {
    window.open(WHATSAPP_URL, "_blank", "noopener,noreferrer");
  }

  function callStore() {
    window.location.href = "tel:1139648294";
  }

  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      <Button
        className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-700"
        onClick={openWhatsApp}
        aria-label="Conversar com a Persi Materiais pelo WhatsApp"
      >
        <WhatsAppIcon className="h-5 w-5" aria-hidden="true" />
        WhatsApp
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={callStore}
        aria-label="Ligar para a loja Persi Materiais"
      >
        <Phone className="h-5 w-5" aria-hidden="true" />
        Ligar para a loja
      </Button>
    </div>
  );
}
