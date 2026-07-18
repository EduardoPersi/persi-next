"use client";

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

type MobileMenuProps = {
  open: boolean;
  onClose: () => void;
};

const categories = [
  "Acabamentos",
  "Banheiro e Cozinha",
  "Elétrica",
  "Ferragens",
  "Ferramentas",
  "Hidráulica",
  "Materiais de Construção",
  "Pintura",
  "Utilidades",
];

export function MobileMenu({ open, onClose }: MobileMenuProps) {
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
          <a
            href="#"
            className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition hover:bg-slate-100"
          >
            <User size={20} />
            Minha Conta
          </a>

          <a
            href="#"
            className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition hover:bg-slate-100"
          >
            <Heart size={20} />
            Favoritos
          </a>

          <a
            href="#"
            className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition hover:bg-slate-100"
          >
            <Package size={20} />
            Meus Pedidos
          </a>

          <a
            href="#"
            className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition hover:bg-slate-100"
          >
            <MapPin size={20} />
            Nossa Loja
          </a>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-5 pb-2 pt-5 text-xs font-bold uppercase tracking-wider text-slate-500">
            Categorias
          </div>

          <nav className="px-3 pb-6">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 py-3.5 text-left text-sm font-medium transition hover:bg-slate-100"
              >
                <span>{category}</span>
                <ChevronRight size={18} className="text-slate-400" />
              </button>
            ))}
          </nav>
        </div>
      </div>
    </Drawer>
  );
}
