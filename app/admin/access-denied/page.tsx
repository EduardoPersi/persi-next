import { adminLogout } from "../mfa/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acesso negado | Persi", robots: { index: false, follow: false } };
export default function AdminAccessDeniedPage() {
  return <main className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-[#071f5c]">Acesso não autorizado</h1><p className="mt-2 text-slate-600">Esta identidade não possui uma membership administrativa ativa.</p><form action={adminLogout} className="mt-6"><button className="min-h-11 rounded-xl border px-4 font-semibold">Encerrar sessão</button></form></main>;
}
