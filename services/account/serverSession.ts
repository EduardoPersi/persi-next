import { cookies } from "next/headers";
import { auth } from "@/auth";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import type { AccountSession } from "@/lib/account/validation";
import { getAccountSession } from "./auth";

async function getLegacyAccountToken(): Promise<string | null> {
  const token = (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

// Verifica o cookie do fluxo antigo primeiro (sem custo de rede) e só então
// cai para a sessão do NextAuth (Google/Facebook/Credentials). Os dois
// convivem até o fluxo antigo ser removido.
export async function getServerAccountToken(): Promise<string | null> {
  const legacyToken = await getLegacyAccountToken();
  if (legacyToken) return legacyToken;

  const session = await auth();
  return session?.wpSessionToken ?? null;
}

export async function getServerAccountSession(): Promise<AccountSession | null> {
  const legacyToken = await getLegacyAccountToken();
  if (legacyToken) {
    try {
      const session = await getAccountSession(legacyToken);
      if (session.authenticated) return session;
    } catch {
      // cai para a checagem via NextAuth abaixo
    }
  }

  const session = await auth();
  if (session?.wpSessionToken && session.wpSessionExpiresAt && session.customer) {
    return {
      authenticated: true,
      expiresAt: session.wpSessionExpiresAt,
      customer: session.customer,
    };
  }

  return null;
}
