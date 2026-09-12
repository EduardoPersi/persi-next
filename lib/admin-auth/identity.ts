import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminAuthServerClient } from "./server";
import { mapSupabaseAal, type AdminMfaAssurance } from "./assurance";

export type VerifiedAdminIdentity = {
  identityProvider: "supabase_auth";
  identitySubject: string;
  assurance: AdminMfaAssurance;
};

export async function verifyAdminIdentity(
  client?: SupabaseClient,
): Promise<VerifiedAdminIdentity | null> {
  const auth = client ?? (await createAdminAuthServerClient());
  const { data: userData, error: userError } = await auth.auth.getUser();
  if (userError || !userData.user) return null;
  const { data: aalData, error: aalError } =
    await auth.auth.mfa.getAuthenticatorAssuranceLevel();
  const assurance = mapSupabaseAal(aalData?.currentLevel, Boolean(aalError));
  return {
    identityProvider: "supabase_auth",
    identitySubject: userData.user.id,
    assurance,
  };
}

export async function getAdminMfaDestination(client?: SupabaseClient) {
  const auth = client ?? (await createAdminAuthServerClient());
  const { data, error } = await auth.auth.mfa.listFactors();
  if (error) return "/admin/login?error=ADMIN_AUTH_FAILED";
  return data.totp.some((factor) => factor.status === "verified")
    ? "/admin/mfa?mode=challenge"
    : "/admin/mfa?mode=enroll";
}
