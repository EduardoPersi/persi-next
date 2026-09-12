import { redirect } from "next/navigation";
import { createAdminAuthServerClient } from "@/lib/admin-auth/server";
import { verifyAdminIdentity } from "@/lib/admin-auth/identity";
import { safeAdminDestination } from "@/lib/admin-auth/redirect";
import { MfaForm } from "./MfaForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificação administrativa | Persi", robots: { index: false, follow: false } };
export default async function AdminMfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await createAdminAuthServerClient();
  const identity = await verifyAdminIdentity(client);
  if (!identity) redirect("/admin/login");
  const params = await searchParams;
  const next = safeAdminDestination(params.next);
  if (identity.assurance === "verified") redirect(next);
  const { data } = await client.auth.mfa.listFactors();
  const mode = data?.totp.some((factor) => factor.status === "verified") ? "challenge" : "enroll";
  return <main className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-[#071f5c]">Verificação em duas etapas</h1><p className="mt-2 text-sm text-slate-600">O acesso administrativo exige um código TOTP válido.</p><MfaForm mode={mode} next={next}/></main>;
}
