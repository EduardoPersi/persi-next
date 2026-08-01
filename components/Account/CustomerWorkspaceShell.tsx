"use client";

import Link from "next/link";
import { Menu, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { Drawer } from "@/components/Header/Drawer";
import { AccountDrawerHeader } from "./AccountDrawerHeader";
import { AccountLogoutButton } from "./AccountLogoutButton";
import {
  CUSTOMER_WORKSPACE_NAVIGATION,
  isCustomerWorkspaceItemActive,
} from "@/lib/customer-workspace/navigation";

interface CustomerWorkspaceShellProps {
  children: ReactNode;
  customerName: string;
  customerEmail: string;
}

function WorkspaceNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu da minha conta">
      <ul className="m-0 list-none space-y-1 p-0">
        {CUSTOMER_WORKSPACE_NAVIGATION.map((item) => {
          const active = isCustomerWorkspaceItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold no-underline transition-[color,background-color,transform,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] ${
                  active
                    ? "bg-[#0c2d72] !text-white shadow-sm"
                    : "text-slate-700 hover:translate-x-1 hover:bg-slate-100 hover:text-[#0c2d72]"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
        <li className="border-t border-slate-200 pt-2">
          <AccountLogoutButton />
        </li>
      </ul>
    </nav>
  );
}

export function CustomerWorkspaceShell({
  children,
  customerName,
  customerEmail,
}: CustomerWorkspaceShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const titleId = useId();
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-7">
      <aside className="hidden lg:block">
        <div className="sticky top-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0c2d72]/10 text-[#0c2d72]">
              <UserRound aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#071f5c]">{customerName}</p>
              <p className="truncate text-xs text-slate-500">{customerEmail}</p>
            </div>
          </div>
          <WorkspaceNavigation />
        </div>
      </aside>

      <div className="min-w-0">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 font-semibold text-[#0c2d72] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] lg:hidden"
          aria-controls="customer-workspace-menu"
          aria-expanded={mobileOpen}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
          Menu da conta
        </button>
        <div key={pathname} className="workspace-content-enter">
          {children}
        </div>
      </div>

      <Drawer
        id="customer-workspace-menu"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        side="left"
        widthClassName="max-w-[340px]"
        titleId={titleId}
      >
        <AccountDrawerHeader
          title="Minha conta"
          titleId={titleId}
          onClose={() => setMobileOpen(false)}
        />
        <div className="p-5">
          <WorkspaceNavigation onNavigate={() => setMobileOpen(false)} />
        </div>
      </Drawer>
    </div>
  );
}
