"use client";
import { useActionState, useState } from "react";
import Image from "next/image";
import { safeAdminAuthMessage } from "@/lib/admin-auth/errors";
import { beginTotpEnrollment, verifyAdminTotp, type MfaActionState } from "./actions";

const initialState: MfaActionState = {};
export function MfaForm({ mode, next }: { mode: "enroll" | "challenge"; next: string }) {
  const [enrollment, setEnrollment] = useState<MfaActionState>({});
  const [state, action, pending] = useActionState(verifyAdminTotp, initialState);
  async function enroll() { setEnrollment(await beginTotpEnrollment()); }
  const error = state.code ?? enrollment.code;
  return <div className="mt-6 space-y-4">
    {mode === "enroll" && !enrollment.qrCode && <button type="button" onClick={enroll} className="min-h-11 w-full rounded-xl border border-[#0c2d72] font-semibold text-[#0c2d72]">Configurar aplicativo autenticador</button>}
    {enrollment.qrCode && <div className="rounded-xl border p-4"><p className="mb-3 text-sm">Escaneie o QR code no aplicativo autenticador.</p><Image unoptimized width={192} height={192} src={enrollment.qrCode} alt="QR code para configurar autenticação em duas etapas" className="mx-auto size-48"/></div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{safeAdminAuthMessage(error)}</p>}
    {(mode === "challenge" || enrollment.qrCode) && <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next}/>
      <label className="block text-sm font-semibold">Código do autenticador<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} name="code" className="mt-1 min-h-11 w-full rounded-xl border px-3 tracking-[0.35em]"/></label>
      <button disabled={pending} className="min-h-11 w-full rounded-xl bg-[#ff6a00] px-4 font-semibold text-white disabled:opacity-60">{pending ? "Verificando…" : "Verificar código"}</button>
    </form>}
  </div>;
}
