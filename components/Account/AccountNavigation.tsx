import Link from "next/link";
import { AccountLogoutButton } from "./AccountLogoutButton";

export function AccountNavigation() {
  return (
    <nav aria-label="Menu da minha conta" className="mb-7 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-5">
      <Link href="/minha-conta" className="rounded-xl px-3 py-2 font-medium text-primary hover:bg-slate-100">Visão geral</Link>
      <Link href="/minha-conta/pedidos" className="rounded-xl px-3 py-2 font-medium text-primary hover:bg-slate-100">Meus pedidos</Link>
      <Link href="/minha-conta/listas" className="rounded-xl px-3 py-2 font-medium text-primary hover:bg-slate-100">Minhas listas</Link>
      <Link href="/minha-conta/enderecos" className="rounded-xl px-3 py-2 font-medium text-primary hover:bg-slate-100">Endereços</Link>
      <Link href="/minha-conta/perfil" className="rounded-xl px-3 py-2 font-medium text-primary hover:bg-slate-100">Dados pessoais</Link>
      <AccountLogoutButton />
    </nav>
  );
}
