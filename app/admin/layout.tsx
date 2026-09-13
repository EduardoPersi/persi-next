import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { adminLogout } from "./mfa/actions";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin PIM | Persi Materiais", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Presence-only check (no DB call): distinguishes public admin screens (login, MFA
  // pre-verify) from an authenticated context, without duplicating requireAdminPermission.
  const hasNativeSession = Boolean((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  return <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="border-b border-slate-200 bg-[#071f5c] text-white"><div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <Link href="/admin/pim" className="text-lg font-bold">Admin Persi</Link>
      <nav aria-label="Administração" className="flex items-center gap-4 text-sm"><Link href="/admin/pim">PIM</Link><Link href="/admin/products">Produtos</Link></nav>
      {hasNativeSession && <div className="flex items-center gap-4">
        <span className="hidden text-sm text-blue-100 md:block">Área administrativa protegida</span>
        <form action={adminLogout}>
          <button type="submit" className="min-h-11 rounded-xl border border-white/30 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Sair</button>
        </form>
      </div>}
    </div></header><main id="main-content" className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
  </div>;
}
