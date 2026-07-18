"use client";

import { MobileMenu } from "./MobileMenu";
import { MiniCart } from "./MiniCart";
import { useState } from "react";
import {
  Heart,
  MapPin,
  Menu,
  Search,
  ShoppingCart,
  Truck,
  User,
  X,
} from "lucide-react";

const menuItems = [
  "Todas as Categorias",
  "Promoções",
  "Hidráulica",
  "Elétrica",
  "Impermeabilização",
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  return (
    <header>
      {/* Barra de frete */}
      <div className="bg-[#071f5c] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1 text-center text-xs font-semibold sm:text-sm">
          <Truck size={16} className="shrink-0" />

          <span>
            Frete grátis para diversos itens e para a região de Jundiaí.
            Consulte!
          </span>
        </div>
      </div>

      {/* Cabeçalho principal */}
      <div className="bg-[#0c2d72] text-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Botão mobile */}
            <button
              type="button"
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
              className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 md:hidden"
            >
              {menuOpen ? <X size={27} /> : <Menu size={27} />}
            </button>

            {/* Logo temporário */}
            <a
              href="#"
              className="text-3xl font-semibold tracking-tight text-[#ff6a00] sm:text-4xl lg:text-5xl"
            >
              Persi
            </a>

            {/* Busca desktop */}
            <form className="hidden flex-1 overflow-hidden rounded-md bg-white md:flex">
              <input
                type="search"
                placeholder="Pesquisar produtos na Persi"
                className="min-w-0 flex-1 px-5 py-3 text-sm text-slate-900 outline-none"
              />

              <button
                type="submit"
                aria-label="Pesquisar"
                className="flex items-center justify-center px-4 text-[#0c2d72] transition hover:bg-slate-100"
              >
                <Search size={23} />
              </button>
            </form>

            {/* Ações */}
           {/* Ações */}
<nav className="flex shrink-0 items-center gap-2 lg:gap-3">
  <a
    href="#"
    className="hidden whitespace-nowrap text-sm text-white/70 transition hover:text-white lg:block"
  >
    Rastrear pedido
  </a>

  <span className="hidden h-6 w-px bg-white/30 lg:block" />

  <a
    href="#"
    aria-label="Login ou cadastro"
    className="flex h-10 items-center justify-center gap-2 rounded-md px-2 transition hover:bg-white/10 xl:px-3"
  >
    <User size={23} className="shrink-0" />

    <span className="hidden whitespace-nowrap text-sm font-semibold xl:inline">
      Login / Registrar
    </span>
  </a>

  <a
    href="#"
    aria-label="Favoritos"
    className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/30 transition hover:bg-white/10 sm:flex"
  >
    <Heart size={24} />
  </a>

  <button
  type="button"
  onClick={() => setCartOpen(true)}
  aria-label="Carrinho"
  className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/30 transition hover:bg-white/10"
>
  <ShoppingCart size={24} />

  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-[#0c2d72]">
    0
  </span>
</button>
</nav>
          </div>

          {/* Busca mobile */}
          <form className="mt-3 flex overflow-hidden rounded-md bg-white md:hidden">
            <input
              type="search"
              placeholder="O que você está procurando?"
              className="min-w-0 flex-1 px-4 py-3 text-sm text-slate-900 outline-none"
            />

            <button
              type="submit"
              aria-label="Pesquisar"
              className="flex items-center justify-center px-4 text-[#0c2d72]"
            >
              <Search size={22} />
            </button>
          </form>
        </div>
      </div>

      {/* Navegação desktop */}
      <div className="hidden bg-[#ff6500] text-white md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4">
          <nav className="flex items-center">
            {menuItems.map((item) => (
              <a
                key={item}
                href="#"
                className="border-r border-white/40 px-3 py-3 text-sm font-semibold transition last:border-r-0 hover:bg-black/10 lg:px-4"
              >
                {item}
              </a>
            ))}
          </nav>

          <a
            href="#"
            className="hidden items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-black/10 lg:flex"
          >
            <MapPin size={18} />
            Nossa Loja
          </a>
        </div>
      </div>

      {/* Menu mobile */}
      <MobileMenu
  open={menuOpen}
  onClose={() => setMenuOpen(false)}
/>
<MiniCart
  open={cartOpen}
  onClose={() => setCartOpen(false)}
/>
    </header>
  );
}