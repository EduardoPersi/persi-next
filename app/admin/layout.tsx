import Link from "next/link";
import type { ReactNode } from "react";
import { requirePimAdmin } from "@/lib/pim/authorization";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin PIM | Persi Materiais", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePimAdmin();
  return <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="border-b border-slate-200 bg-[#071f5c] text-white"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-6 px-4 py-3 sm:px-6">
      <Link href="/admin/products" className="text-lg font-bold">Persi PIM</Link>
      <nav aria-label="Administração PIM" className="flex items-center gap-4 text-sm"><Link href="/admin/products">Produtos</Link><Link href="/admin/pim">Revisão</Link></nav>
      <span className="hidden text-sm text-blue-100 md:block">{user.displayName || user.email}</span>
    </div></header><main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
  </div>;
}
