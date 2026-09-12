import { NextResponse } from "next/server";
import { createAdminAuthServerClient } from "@/lib/admin-auth/server";
import { safeAdminDestination } from "@/lib/admin-auth/redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeAdminDestination(url.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/admin/login?error=ADMIN_AUTH_FAILED", url));
  try {
    const client = await createAdminAuthServerClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return NextResponse.redirect(new URL(`/admin/mfa?next=${encodeURIComponent(next)}`, url));
  } catch {
    return NextResponse.redirect(new URL("/admin/login?error=ADMIN_AUTH_FAILED", url));
  }
}
