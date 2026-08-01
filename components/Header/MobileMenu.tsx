"use client";

import Link from "next/link";
import {
  ChevronRight,
  Heart,
  MapPin,
  Menu,
  Package,
  User,
  X,
} from "lucide-react";
import { Drawer } from "./Drawer";
import { MegaMenuMobile } from "@/components/navigation/MegaMenuMobile";
import { useNavigation } from "@/components/navigation/NavigationProvider";

type MobileMenuProps = {
  open: boolean;
  onClose: () => void;
  accountHref?: "/entrar" | "/minha-conta";
  accountStatus: "loading" | "authenticated" | "anonymous";
  onAccountAction: () => void;
};

export function MobileMenu({
  open,
  onClose,
  accountHref,
  accountStatus,
  onAccountAction,
}: MobileMenuProps) {
  const { categories } = useNavigation();

  return (
    <Drawer open={open} onClose={onClose} side="left">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Menu size={22} />
            <h2 className="text-lg font-bold">Menu</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar menu"
            className="rounded-md p-2 transition hover:bg-slate-100"
          >
            <X size={22} />
          </button>
        </header>

        <div className="border-b px-3 py-3">
          {accountHref ? (
            <Link
              href={accountHref}
              onClick={onClose}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition hover:bg-slate-100"
            >
              <User size={20} />
              Minha Conta
            </Link>
          ) : (
            <button
              type="button"
              disabled={accountStatus === "loading"}
              onClick={() => {
                onClose();
                onAccountAction();
              }}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
            >
              <User size={20} />
              Minha Conta
            </button>
          )}

          <Link
            href="/favoritos"
            onClick={onClose}
            className="flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition hover:bg-slate-100"
          >
            <Heart size={20} />
            Favoritos
          </Link>

          <Link
            href="/minha-conta/pedidos"
            onClick={onClose}
            className="flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition hover:bg-slate-100"
          >
            <Package size={20} />
            Meus Pedidos
          </Link>

          <Link
            href="/contato"
            onClick={onClose}
            className="flex items-center gap-3 rounded-md px-3 py-3 text-[17px] font-semibold transition hover:bg-slate-100"
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
              className="flex items-center justify-between rounded-md px-3 py-3.5 text-[17px] font-semibold text-[#0c2d72] transition hover:bg-slate-100"
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
