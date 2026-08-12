"use client";

import Link from "next/link";
import {
  ChevronRight,
  Heart,
  MapPin,
  Package,
  User,
  X,
} from "lucide-react";
import { Drawer } from "./Drawer";
import { MegaMenuMobile } from "@/components/navigation/MegaMenuMobile";
import { useNavigation } from "@/components/navigation/NavigationProvider";
import { IconButton } from "@/components/UI/IconButton";

type MobileMenuProps = {
  open: boolean;
  onClose: () => void;
  accountHref?: "/entrar" | "/minha-conta";
  accountStatus: "loading" | "authenticated" | "anonymous";
  customerName?: string;
  onAccountAction: () => void;
};

export function MobileMenu({
  open,
  onClose,
  accountHref,
  accountStatus,
  customerName,
  onAccountAction,
}: MobileMenuProps) {
  const { categories } = useNavigation();
  const accountLabel =
    accountStatus === "authenticated" && customerName
      ? customerName
      : "Minha Conta";

  return (
    <Drawer open={open} onClose={onClose} side="left">
      <div className="relative flex h-full flex-col" data-route-transition-skip>
        <h2 className="sr-only">Menu</h2>
        <IconButton
          onClick={onClose}
          aria-label="Fechar menu"
          className="absolute right-3 top-3 z-10"
        >
          <X size={22} />
        </IconButton>

        <div className="border-b px-3 pb-3 pt-3">
          {accountHref ? (
            <Link
              href={accountHref}
              onClick={onClose}
              className="tap-feedback flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition-colors hover:bg-slate-100"
            >
              <User size={20} />
              {accountLabel}
            </Link>
          ) : (
            <button
              type="button"
              disabled={accountStatus === "loading"}
              onClick={() => {
                onClose();
                onAccountAction();
              }}
              className="tap-feedback flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
            >
              <User size={20} />
              {accountLabel}
            </button>
          )}

          <Link
            href="/favoritos"
            onClick={onClose}
            className="tap-feedback flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition-colors hover:bg-slate-100"
          >
            <Heart size={20} />
            Favoritos
          </Link>

          <Link
            href="/minha-conta/pedidos"
            onClick={onClose}
            className="tap-feedback flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition-colors hover:bg-slate-100"
          >
            <Package size={20} />
            Meus Pedidos
          </Link>

          <Link
            href="/contato"
            onClick={onClose}
            className="tap-feedback flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition-colors hover:bg-slate-100"
          >
            <MapPin size={20} />
            Nossa Loja
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b px-3 py-3">
            <Link
              href="/promocoes"
              onClick={onClose}
              className="tap-feedback flex items-center justify-between rounded-md px-3 py-3.5 text-[17px] font-semibold text-[#0c2d72] transition-colors hover:bg-slate-100"
            >
              <span>Promoções</span>
              <ChevronRight size={18} className="text-[#ff6a00]" />
            </Link>
          </div>
          <div className="px-5 pb-2 pt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Categorias
          </div>

          <div className="px-3 pb-6">
            <MegaMenuMobile categories={categories} onNavigate={onClose} />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
