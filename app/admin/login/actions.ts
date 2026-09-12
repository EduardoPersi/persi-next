"use server";
import { redirect } from "next/navigation";
import { createAdminAuthServerClient } from "@/lib/admin-auth/server";
import { getAdminMfaDestination } from "@/lib/admin-auth/identity";
import { safeAdminDestination } from "@/lib/admin-auth/redirect";
import { adminRateKey, enforceAdminRateLimit } from "@/lib/admin/rate-limit";

export async function adminPasswordSignIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const destination = safeAdminDestination(formData.get("next"));
  try {
    await enforceAdminRateLimit({ identitySubject: adminRateKey(email), operation: "admin.login" });
    const client = await createAdminAuthServerClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error("ADMIN_AUTH_FAILED");
    redirect(`${await getAdminMfaDestination(client)}&next=${encodeURIComponent(destination)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/admin/login?error=ADMIN_AUTH_FAILED");
  }
}
