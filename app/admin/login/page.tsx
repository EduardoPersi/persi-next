import { safeAdminAuthMessage } from "@/lib/admin-auth/errors";
import { safeAdminDestination } from "@/lib/admin-auth/redirect";
import { adminPasswordSignIn } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acesso administrativo | Persi", robots: { index: false, follow: false } };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const next = safeAdminDestination(params.next);
  return <main className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6 shadow-sm">
    <h1 className="text-2xl font-bold text-[#071f5c]">Acesso administrativo</h1>
    <p className="mt-2 text-sm text-slate-600">Entre com a identidade administrativa previamente provisionada.</p>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{safeAdminAuthMessage(error)}</p>}
    <form action={adminPasswordSignIn} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next}/>
      <label className="block text-sm font-semibold">E-mail<input required autoComplete="username" type="email" name="email" className="mt-1 min-h-11 w-full rounded-xl border px-3"/></label>
      <label className="block text-sm font-semibold">Senha<input required autoComplete="current-password" type="password" name="password" className="mt-1 min-h-11 w-full rounded-xl border px-3"/></label>
      <button className="min-h-11 w-full rounded-xl bg-[#0c2d72] px-4 font-semibold text-white">Continuar</button>
    </form>
  </main>;
}
