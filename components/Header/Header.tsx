"use client";

import Image from "next/image";
import Link from "next/link";

import { MobileMenu } from "./MobileMenu";
import { MiniCart } from "./MiniCart";
import { useCart } from "@/hooks/useCart";
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
  const { cart, openCart } = useCart();

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

            <Link
              href="/"
              aria-label="Ir para a página inicial da Persi Materiais"
            >
              <Image
                src="/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp"
                alt="Persi Materiais Elétricos, Hidráulicos e Ferramentas"
                width={130}
                height={53}
                priority
                className="h-auto w-[130px] max-w-full object-contain"
              />
            </Link>

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
    className="hidden h-10 w-10 items-center justify-center p-2 transition hover:text-[#ff6a00] sm:flex"
  >
    <Heart size={24} />
  </a>

  <button
  type="button"
  onClick={openCart}
  aria-label="Carrinho"
  className="relative flex h-10 w-10 items-center justify-center p-2 transition hover:text-white/80"
>
  <ShoppingCart className="h-7 w-7" />

  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff6a00] px-1 text-[10px] font-bold leading-none text-white">
    {cart?.itemsCount ?? 0}
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
<MiniCart />
    </header>
  );
}
