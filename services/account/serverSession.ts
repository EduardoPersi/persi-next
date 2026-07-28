import { cookies } from "next/headers";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import type { AccountSession } from "@/lib/account/validation";
import { getAccountSession } from "./auth";

export async function getServerAccountToken(): Promise<string | null> {
  const token = (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function getServerAccountSession(): Promise<AccountSession | null> {
  const token = await getServerAccountToken();
  if (!token) return null;

  try {
    const session = await getAccountSession(token);
    return session.authenticated ? session : null;
  } catch {
    return null;
  }
}
