"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Heart,
  MapPin,
  Menu,
  ShoppingCart,
  Truck,
  User,
  X,
} from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { useAccount } from "@/hooks/useAccount";
import { useFavorites } from "@/hooks/useFavorites";
import { getHeaderAccountAction } from "@/lib/account/headerNavigation";
import type { AccountSessionResult } from "@/lib/account/validation";
import { AccountDrawer } from "@/components/Account/AccountDrawer";
import { AccountDropdown } from "@/components/Account/AccountDropdown";
import { MiniCart } from "./MiniCart";
import { MobileMenu } from "./MobileMenu";
import { ProductSearch } from "./ProductSearch";

const menuItems = [
  { label: "Todas as Categorias", href: "/" },
  { label: "Promoções", href: "/promocoes" },
  { label: "Hidráulica", href: "/hidraulica" },
  { label: "Elétrica", href: "/eletrica" },
  { label: "Impermeabilização", href: "/impermeabilizacao" },
];

interface HeaderLogoProps {
  compact?: boolean;
}

function HeaderLogo({ compact = false }: HeaderLogoProps) {
  return (
    <Link
      href="/"
      aria-label="Ir para a página inicial da Persi Materiais"
      className="shrink-0"
    >
      <Image
        src="/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp"
        alt="Persi Materiais Elétricos, Hidráulicos e Ferramentas"
        width={130}
        height={53}
        priority
        className={
          compact
            ? "h-auto w-[86px] max-w-full object-contain sm:w-[100px] md:w-[110px]"
            : "h-auto w-[90px] max-w-full object-contain md:w-[110px]"
        }
      />
    </Link>
  );
}

interface HeaderActionsProps {
  itemsCount: number;
  favoritesCount: number;
  isCartPage: boolean;
  isCartOpen: boolean;
  onOpenCart: () => void;
  accountDrawerOpen: boolean;
  canOpenAccountDrawer: boolean;
  onAccountAction: () => void;
  accountLabel: string;
  accountStatus: "loading" | "authenticated" | "anonymous";
  customerName: string;
  customerEmail: string;
  onLogout: () => Promise<void>;
  compact?: boolean;
}

function HeaderActions({
  itemsCount,
  favoritesCount,
  isCartPage,
  isCartOpen,
  onOpenCart,
  accountDrawerOpen,
  canOpenAccountDrawer,
  onAccountAction,
  accountLabel,
  accountStatus,
  customerName,
  customerEmail,
  onLogout,
  compact = false,
}: HeaderActionsProps) {
  return (
    <nav
      className="flex shrink-0 items-center gap-1 sm:gap-2 lg:gap-3"
      aria-label="Ações da conta"
    >
      {!compact ? (
        <>
          <a
            href="#"
            className="hidden whitespace-nowrap text-sm text-white/70 transition hover:text-white lg:block"
          >
            Rastrear pedido
          </a>
          <span className="hidden h-6 w-px bg-white/30 lg:block" />
        </>
      ) : null}

      <div className="md:hidden">
        <button
          type="button"
          onClick={onAccountAction}
          disabled={!canOpenAccountDrawer}
          aria-label={accountLabel}
          aria-expanded={
            canOpenAccountDrawer ? accountDrawerOpen : undefined
          }
          aria-controls={
            canOpenAccountDrawer ? "account-drawer" : undefined
          }
          className="flex h-10 items-center justify-center rounded-md px-2 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
        >
          <User size={compact ? 21 : 23} className="shrink-0" />
        </button>
      </div>

      <AccountDropdown
        status={accountStatus}
        customerName={customerName}
        customerEmail={customerEmail}
        onOpenDrawer={onAccountAction}
        onLogout={onLogout}
        compact={compact}
      />

      <Link
        href="/favoritos"
        aria-label={`Favoritos: ${favoritesCount} ${favoritesCount === 1 ? "produto" : "produtos"}`}
        className="relative hidden h-10 w-10 items-center justify-center p-2 transition hover:text-[#ff6a00] md:flex"
      >
        <Heart size={compact ? 21 : 24} />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff6a00] px-1 text-[10px] font-bold leading-none text-white">{favoritesCount}</span>
      </Link>

      <button
        type="button"
        onClick={onOpenCart}
        aria-label={
          isCartPage ? "Atualizar página do carrinho" : "Abrir mini carrinho"
        }
        aria-expanded={isCartPage ? undefined : isCartOpen}
        aria-controls={isCartPage ? undefined : "mini-cart-drawer"}
        className="relative flex h-10 w-10 items-center justify-center p-2 transition hover:text-white/80"
      >
        <ShoppingCart className={compact ? "h-6 w-6" : "h-7 w-7"} />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff6a00] px-1 text-[10px] font-bold leading-none text-white">
          {itemsCount}
        </span>
      </button>
    </nav>
  );
}

function HeaderContent() {
  const pathname = usePathname();
  const fullHeaderRef = useRef<HTMLElement>(null);
  const lastScrollYRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountDrawerPathname, setAccountDrawerPathname] = useState<
    string | null
  >(null);
  const [showCompactHeader, setShowCompactHeader] = useState(false);
  const { cart, closeCart, isOpen: isCartOpen, openCart } = useCart();
  const { status: accountStatus, customer, logout } = useAccount();
  const { count: favoritesCount } = useFavorites();
  const isCartPage = pathname === "/carrinho";
  const itemsCount = cart?.itemsCount ?? 0;
  const accountLabel =
    accountStatus === "authenticated"
      ? customer?.firstName || customer?.displayName || "Minha conta"
      : "Login / Registrar";
  const closeAccount = useCallback(() => setAccountDrawerPathname(null), []);
  const accountAction = getHeaderAccountAction(accountStatus, pathname);
  const accountHref =
    accountAction === "go-to-account"
      ? "/minha-conta"
      : accountAction === "go-to-login"
        ? "/entrar"
        : undefined;
  const canOpenAccountDrawer = accountStatus !== "loading";
  const accountOpen =
    canOpenAccountDrawer && accountDrawerPathname === pathname;
  const handleAccountAction = useCallback(() => {
    if (accountStatus === "loading") return;
    setAccountDrawerPathname(pathname);
  }, [accountStatus, pathname]);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const handleCartClick = useCallback(() => {
    if (!isCartPage) {
      openCart();
      return;
    }

    closeCart();
    window.location.reload();
  }, [closeCart, isCartPage, openCart]);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    function handleScroll() {
      if (frameRef.current !== null) return;

      frameRef.current = window.requestAnimationFrame(() => {
        const currentScrollY = Math.max(window.scrollY, 0);
        const previousScrollY = lastScrollYRef.current;
        const scrollDifference = currentScrollY - previousScrollY;
        const fullHeaderHeight = fullHeaderRef.current?.offsetHeight ?? 0;

        if (currentScrollY <= 8) {
          setShowCompactHeader(false);
          lastScrollYRef.current = currentScrollY;
        } else if (Math.abs(scrollDifference) >= 6) {
          if (scrollDifference < 0 && currentScrollY > fullHeaderHeight) {
            setShowCompactHeader(true);
          } else if (scrollDifference > 0) {
            setShowCompactHeader(false);
          }

          lastScrollYRef.current = currentScrollY;
        }

        frameRef.current = null;
      });
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <header ref={fullHeaderRef}>
      <div className="bg-[#071f5c] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1 text-center text-xs font-semibold sm:text-sm">
          <Truck size={16} className="shrink-0" />
          <span>Frete grátis para Jundiaí e região. Consulte as regras!</span>
        </div>
      </div>

      <div className="bg-[#0c2d72] text-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:py-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
              className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 md:hidden"
            >
              {menuOpen ? <X size={27} /> : <Menu size={27} />}
            </button>

            <HeaderLogo />
            <ProductSearch variant="desktop" />
            <HeaderActions
              itemsCount={itemsCount}
              favoritesCount={favoritesCount}
              isCartPage={isCartPage}
              isCartOpen={isCartOpen}
              onOpenCart={handleCartClick}
              accountDrawerOpen={accountOpen}
              canOpenAccountDrawer={canOpenAccountDrawer}
              onAccountAction={handleAccountAction}
              accountLabel={accountLabel}
              accountStatus={accountStatus}
              customerName={
                customer?.firstName || customer?.displayName || ""
              }
              customerEmail={customer?.email || ""}
              onLogout={logout}
            />
          </div>
          <ProductSearch variant="mobile" />
        </div>
      </div>

      <div className="hidden bg-[#ff6500] text-white md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4">
          <nav className="flex items-center">
            {menuItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="border-r border-white/40 px-3 py-3 text-base font-semibold transition last:border-r-0 hover:bg-black/10 lg:px-4"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <a
            href="#"
            className="hidden items-center gap-2 px-4 py-3 text-base font-semibold hover:bg-black/10 lg:flex"
          >
            <MapPin size={18} />
            Nossa Loja
          </a>
        </div>
      </div>

      <div
        data-search-header
        aria-hidden={!showCompactHeader}
        inert={!showCompactHeader}
        className={`fixed inset-x-0 top-0 z-40 bg-[#0c2d72] text-white shadow-lg transition-[transform,visibility] duration-300 ease-out ${
          showCompactHeader
            ? "visible translate-y-0"
            : "invisible -translate-y-full"
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 py-2">
          <div className="hidden items-center gap-2 sm:gap-3 md:flex">
            <button
              type="button"
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-white/10 md:hidden"
            >
              {menuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <HeaderLogo compact />
            <ProductSearch variant="desktop" />
            <HeaderActions
              itemsCount={itemsCount}
              favoritesCount={favoritesCount}
              isCartPage={isCartPage}
              isCartOpen={isCartOpen}
              onOpenCart={handleCartClick}
              accountDrawerOpen={accountOpen}
              canOpenAccountDrawer={canOpenAccountDrawer}
              onAccountAction={handleAccountAction}
              accountLabel={accountLabel}
              accountStatus={accountStatus}
              customerName={
                customer?.firstName || customer?.displayName || ""
              }
              customerEmail={customer?.email || ""}
              onLogout={logout}
              compact
            />
          </div>
          <ProductSearch variant="mobile" compact />
        </div>
      </div>

      <MobileMenu
        open={menuOpen}
        onClose={closeMenu}
        accountHref={accountHref}
        accountStatus={accountStatus}
        onAccountAction={handleAccountAction}
      />
      <AccountDrawer
        open={accountOpen && canOpenAccountDrawer}
        onClose={closeAccount}
      />
      <MiniCart />
    </header>
  );
}

export function Header({ initialAccountSession }: {
  initialAccountSession?: AccountSessionResult;
}) {
  void initialAccountSession;
  return <HeaderContent />;
}
