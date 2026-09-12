import "server-only";

export const ADMIN_AUTH_COOKIE = "persi_admin_session";

export function getAdminAuthConfig() {
  const url = process.env.ADMIN_SUPABASE_URL;
  const publishableKey = process.env.ADMIN_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("ADMIN_AUTH_UNAVAILABLE");
  return { url, publishableKey };
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
