import Link from "next/link";
import { AccountLogoutButton } from "./AccountLogoutButton";

export function AccountNavigation() {
  return (
    <nav aria-label="Menu da minha conta" className="mb-7 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-5">
      <Link href="/minha-conta" className="rounded-xl px-3 py-2 font-medium text-[#0c2d72] hover:bg-slate-100">Visão geral</Link>
      <Link href="/minha-conta/pedidos" className="rounded-xl px-3 py-2 font-medium text-[#0c2d72] hover:bg-slate-100">Meus pedidos</Link>
      <Link href="/minha-conta/listas" className="rounded-xl px-3 py-2 font-medium text-[#0c2d72] hover:bg-slate-100">Minhas listas</Link>
      <span aria-disabled="true" className="cursor-not-allowed rounded-xl px-3 py-2 text-slate-400">Endereços</span>
      <span aria-disabled="true" className="cursor-not-allowed rounded-xl px-3 py-2 text-slate-400">Dados pessoais</span>
      <AccountLogoutButton />
    </nav>
  );
}
