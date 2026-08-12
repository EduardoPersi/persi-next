"use client";

import Link from "next/link";
import {
  Bell,
  Heart,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Package,
  User,
  UserRound,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import type { HeaderAccountStatus } from "@/lib/account/headerNavigation";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useOverlayManager } from "@/hooks/useOverlayManager";

interface AccountDropdownProps {
  status: HeaderAccountStatus;
  customerName: string;
  customerEmail: string;
  compact?: boolean;
  onOpenDrawer: () => void;
  onLogout: () => Promise<void>;
}

const accountItems = [
  {
    href: "/minha-conta",
    icon: LayoutDashboard,
    label: "Painel",
    available: true,
  },
  {
    href: "/minha-conta/pedidos",
    icon: Package,
    label: "Pedidos",
    available: true,
  },
  {
    href: "/minha-conta/enderecos",
    icon: MapPinned,
    label: "Endereços",
    available: true,
  },
  {
    href: "/minha-conta/perfil",
    icon: UserRound,
    label: "Dados pessoais",
    available: true,
  },
  {
    href: "/minha-conta/lista-espera",
    icon: Bell,
    label: "Lista de espera",
    available: true,
  },
  {
    href: "/minha-conta/listas",
    icon: Heart,
    label: "Minhas listas",
    available: true,
  },
] as const;

export function AccountDropdown({
  status,
  customerName,
  customerEmail,
  compact = false,
  onOpenDrawer,
  onLogout,
}: AccountDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    left: 16,
    top: 64,
  });
  const authenticated = status === "authenticated";
  const loading = status === "loading";
  const dropdownId = compact
    ? "account-desktop-dropdown-compact"
    : "account-desktop-dropdown";
  const label = authenticated
    ? `Olá, ${customerName || "Cliente"}`
    : "Login / Registrar";

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function updateDropdownPosition() {
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const width = 336;
      const viewportPadding = 16;
      setDropdownPosition({
        left: Math.min(
          Math.max(
            rect.left + rect.width / 2 - width / 2,
            viewportPadding,
          ),
          window.innerWidth - width - viewportPadding,
        ),
        top: rect.bottom + 8,
      });
    }
  }

  function openDropdown() {
    clearCloseTimer();
    if (
      loading ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      return;
    }

    updateDropdownPosition();
    setOpen(true);
  }

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    if (
      loading ||
      !(event.target instanceof HTMLElement) ||
      !event.target.matches(":focus-visible")
    ) {
      return;
    }

    clearCloseTimer();
    updateDropdownPosition();
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  }

  function closeDropdown() {
    clearCloseTimer();
    setOpen(false);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      closeDropdown();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeDropdown();
    triggerRef.current?.focus();
  }

  function handleTriggerClick() {
    closeDropdown();
    onOpenDrawer();
  }

  useOverlayManager({
    id: dropdownId,
    isOpen: open,
    onClose: closeDropdown,
    returnFocusRef: triggerRef,
  });
  useClickOutside({
    isOpen: open,
    refs: [containerRef],
    onOutside: closeDropdown,
  });

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await onLogout();
      closeDropdown();
    } finally {
      setLoggingOut(false);
    }
  }

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative hidden md:block"
      onMouseEnter={openDropdown}
      onMouseLeave={scheduleClose}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={loading}
        onClick={handleTriggerClick}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={dropdownId}
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-white transition-colors duration-150 hover:bg-white/10 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-wait disabled:opacity-70 xl:px-3"
      >
        <User size={compact ? 21 : 23} className="shrink-0" aria-hidden="true" />
        {!compact ? (
          <span className="hidden max-w-36 truncate whitespace-nowrap text-sm font-semibold lg:inline">
            {label}
          </span>
        ) : null}
      </button>

      <div
        id={dropdownId}
        style={
          {
            "--account-dropdown-left": `${dropdownPosition.left}px`,
            "--account-dropdown-top": `${dropdownPosition.top}px`,
          } as CSSProperties
        }
        className={`fixed left-(--account-dropdown-left) top-(--account-dropdown-top) z-60 w-84 text-left text-slate-800 transition-[opacity,transform,visibility] duration-200 ease-out ${
          open
            ? "visible translate-y-0 opacity-100"
            : "invisible translate-y-2 opacity-0"
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.4)]">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0c2d72]/10 text-[#0c2d72]">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold text-[#071f5c]">
                  {authenticated
                    ? `Olá, ${customerName || "Cliente"}!`
                    : "Olá!"}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {authenticated
                    ? "Gerencie pedidos, endereços e sua conta."
                    : "Entre ou crie sua conta para acompanhar seus pedidos."}
                </p>
              </div>
            </div>

            {authenticated ? (
              <>
                <p className="mt-3 truncate text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Conta:</span>{" "}
                  {customerEmail}
                </p>
                <Link
                  href="/minha-conta"
                  onClick={closeDropdown}
                  className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-[#0c2d72] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#071f5c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2"
                >
                  Minha Conta
                </Link>
              </>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleTriggerClick}
                  className="flex min-h-11 items-center justify-center rounded-xl bg-[#0c2d72] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#071f5c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2"
                >
                  Entrar
                </button>
                <Link
                  href="/criar-conta"
                  onClick={closeDropdown}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-[#0c2d72] px-3 text-sm font-semibold text-[#0c2d72] transition-colors hover:bg-[#0c2d72]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2"
                >
                  Criar conta
                </Link>
              </div>
            )}
          </div>

          {authenticated ? (
            <nav className="mt-3" aria-label="Menu da conta">
              <ul className="space-y-1">
                {accountItems.map((item) => {
                  const Icon = item.icon;

                  return (
                    <li key={item.label}>
                      {item.available ? (
                        <Link
                          href={item.href}
                          onClick={closeDropdown}
                          className="group flex min-h-12 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors duration-150 hover:bg-[#0c2d72]/8 hover:text-[#0c2d72] active:bg-[#0c2d72]/14 active:text-[#0c2d72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                        >
                          <Icon
                            className="h-5 w-5 shrink-0 text-slate-500 transition-colors group-hover:text-[#0c2d72]"
                            aria-hidden="true"
                          />
                          {item.label}
                        </Link>
                      ) : (
                        <span
                          className="flex min-h-12 cursor-not-allowed items-center gap-3 rounded-[10px] px-3 text-sm text-slate-400"
                          aria-disabled="true"
                        >
                          <Icon
                            className="h-5 w-5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="flex-1">{item.label}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Em breve
                          </span>
                        </span>
                      )}
                    </li>
                  );
                })}
                <li className="border-t border-slate-100 pt-1">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="group flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm font-medium transition-colors duration-150 hover:bg-[#0c2d72]/8 hover:text-[#0c2d72] active:bg-[#0c2d72]/14 active:text-[#0c2d72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] disabled:cursor-wait disabled:opacity-60"
                  >
                    <LogOut
                      className="h-5 w-5 shrink-0 text-slate-500 transition-colors group-hover:text-[#0c2d72]"
                      aria-hidden="true"
                    />
                    {loggingOut ? "Saindo..." : "Sair"}
                  </button>
                </li>
              </ul>
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
