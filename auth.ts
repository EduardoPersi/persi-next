import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";
import type { NormalizedOAuthUser } from "@/lib/account/oauth/types";
import { getAccountSession, loginAccount } from "@/services/account/auth";
import { createOAuthAccountSession } from "@/services/account/oauthAuth";

const WP_SESSION_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

function normalizeGoogleProfile(
  profile: Record<string, unknown>,
): NormalizedOAuthUser {
  const email = String(profile.email ?? "").trim().toLowerCase();
  const firstName = String(profile.given_name ?? "").trim();
  const lastName = String(profile.family_name ?? "").trim();
  const displayName =
    String(profile.name ?? "").trim() ||
    `${firstName} ${lastName}`.trim() ||
    email.split("@")[0];

  return {
    provider: "google",
    providerId: String(profile.sub ?? ""),
    email,
    name: displayName,
    avatar: typeof profile.picture === "string" ? profile.picture : "",
    verifiedEmail: profile.email_verified === true,
  };
}

function normalizeFacebookProfile(
  profile: Record<string, unknown>,
): NormalizedOAuthUser {
  const email = String(profile.email ?? "").trim().toLowerCase();
  const picture = profile.picture as { data?: { url?: unknown } } | undefined;

  return {
    provider: "facebook",
    providerId: String(profile.id ?? ""),
    email,
    name: String(profile.name ?? "").trim() || email.split("@")[0],
    avatar: typeof picture?.data?.url === "string" ? picture.data.url : "",
    verifiedEmail: true,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  // TODO(Fase C): apontar para "/entrar" quando a página estiver integrada
  // ao NextAuth. Até lá, usa a tela padrão do NextAuth para permitir teste
  // isolado do fluxo em /api/auth/signin.
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { prompt: "select_account" } },
    }),
    Facebook({
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
      authorization: {
        url: `https://www.facebook.com/${process.env.FACEBOOK_GRAPH_API_VERSION}/dialog/oauth`,
        params: { scope: "email,public_profile" },
      },
      token: `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_API_VERSION}/oauth/access_token`,
      userinfo: `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_API_VERSION}/me?fields=id,name,email,picture`,
    }),
    Credentials({
      credentials: {
        identifier: { label: "E-mail", type: "text" },
        password: { label: "Senha", type: "password" },
        remember: { label: "Lembrar", type: "text" },
      },
      async authorize(credentials) {
        const identifier =
          typeof credentials?.identifier === "string"
            ? credentials.identifier.trim()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        const remember =
          credentials?.remember === true || credentials?.remember === "true";
        if (!identifier || !password) return null;

        try {
          const result = await loginAccount({ identifier, password, remember });
          return {
            id: result.customer.email,
            email: result.customer.email,
            name: result.customer.displayName,
            wpSessionToken: result.sessionToken,
            wpSessionExpiresAt: result.expiresAt,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google" && profile?.email_verified !== true) {
        return false;
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "credentials" && user) {
        token.wpSessionToken = user.wpSessionToken;
        token.wpSessionExpiresAt = user.wpSessionExpiresAt;
        token.wpValidatedAt = Date.now();
        token.customer = {
          firstName: user.name ?? "",
          displayName: user.name ?? "",
          email: user.email ?? "",
        };
        return token;
      }

      if (
        (account?.provider === "google" || account?.provider === "facebook") &&
        profile
      ) {
        const normalized =
          account.provider === "google"
            ? normalizeGoogleProfile(profile)
            : normalizeFacebookProfile(profile);
        const session = await createOAuthAccountSession(normalized);
        token.wpSessionToken = session.sessionToken;
        token.wpSessionExpiresAt = session.expiresAt;
        token.wpValidatedAt = Date.now();
        token.customer = session.customer;
        return token;
      }

      if (
        token.wpSessionToken &&
        Date.now() - (token.wpValidatedAt ?? 0) > WP_SESSION_REVALIDATE_INTERVAL_MS
      ) {
        try {
          const result = await getAccountSession(token.wpSessionToken);
          if (!result.authenticated) return null;
          token.wpValidatedAt = Date.now();
          token.customer = result.customer;
        } catch {
          // Falha de rede não derruba a sessão; tenta revalidar na próxima requisição.
        }
      }

      return token;
    },
    async session({ session, token }) {
      session.wpSessionToken = token.wpSessionToken;
      session.customer = token.customer;
      return session;
    },
  },
});
