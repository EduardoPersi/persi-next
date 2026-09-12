"use server";
import { redirect } from "next/navigation";
import { createAdminAuthServerClient } from "@/lib/admin-auth/server";
import { safeAdminDestination } from "@/lib/admin-auth/redirect";
import { enforceAdminRateLimit } from "@/lib/admin/rate-limit";
import { verifyAdminIdentity } from "@/lib/admin-auth/identity";
import { establishAdminSession, revokeCurrentAdminSession } from "@/lib/admin/session";

export type MfaActionState = { code?: string; qrCode?: string };

export async function beginTotpEnrollment(): Promise<MfaActionState> {
  try {
    const client = await createAdminAuthServerClient();
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return { code: "ADMIN_AUTH_FAILED" };
    await enforceAdminRateLimit({ identitySubject: userData.user.id, operation: "admin.mfa.enroll" });
    const { data: factors } = await client.auth.mfa.listFactors();
    if (factors?.totp.some((factor) => factor.status === "verified")) return { code: "ADMIN_MFA_FAILED" };
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Persi Admin" });
    return error ? { code: "ADMIN_MFA_FAILED" } : { qrCode: data.totp.qr_code };
  } catch { return { code: "ADMIN_AUTH_UNAVAILABLE" }; }
}

export async function verifyAdminTotp(_state: MfaActionState, formData: FormData): Promise<MfaActionState> {
  const code = String(formData.get("code") ?? "").trim();
  const destination = safeAdminDestination(formData.get("next"));
  try {
    const client = await createAdminAuthServerClient();
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return { code: "ADMIN_AUTH_FAILED" };
    await enforceAdminRateLimit({ identitySubject: userData.user.id, operation: "admin.mfa.verify" });
    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError) return { code: "ADMIN_MFA_FAILED" };
    const factor = factors.totp.find((item) => item.status === "verified") ?? factors.all.find((item) => item.factor_type === "totp" && item.status === "unverified");
    if (!factor) return { code: "ADMIN_MFA_FAILED" };
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) return { code: "ADMIN_MFA_FAILED" };
    const { error: verifyError } = await client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
    if (verifyError) return { code: "ADMIN_MFA_FAILED" };
    const identity = await verifyAdminIdentity(client);
    if (!identity || identity.assurance !== "verified") return { code: "ADMIN_MFA_FAILED" };
    await establishAdminSession(identity);
  } catch { return { code: "ADMIN_AUTH_UNAVAILABLE" }; }
  redirect(destination);
}

export async function adminLogout() {
  try {
    await revokeCurrentAdminSession();
    const client = await createAdminAuthServerClient();
    await client.auth.signOut({ scope: "local" });
  } finally { redirect("/admin/login"); }
}
