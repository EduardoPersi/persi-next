import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireAdminPermission } from "@/lib/admin/authorization";
import { safeOAuthEqual } from "@/lib/account/oauth/state";
import { completeOlistOAuthAuthorization } from "@/lib/olist/oauthClient";
import { isProductionRuntime } from "@/lib/runtime/runtime-environment";
import { OLIST_OAUTH_APP_COOKIE, OLIST_OAUTH_STATE_COOKIE, getOlistAdminOrigin, isValidOlistOAuthApp } from "@/lib/olist/oauthRouteShared";

// Completes the flow started by ../authorize/route.ts. This is the ONLY
// place in this round's code where OLIST_API_CALLS actually happens for
// real (the authorization-code-for-token exchange) -- and it only runs
// when the admin's own browser lands here after approving the app on
// Olist's page, never on its own.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// No dedicated admin settings page exists yet for this integration
// (deliberately not built this round -- see the design doc's own
// deferred-work list). Rather than redirect a real success or failure to
// an unrelated page (which would confuse the admin into thinking
// something else went wrong), this route renders its own minimal,
// self-contained confirmation directly.
function statusPage(message: string, ok: boolean): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Olist — autorização</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">
  <h1 style="color:${ok ? "#0a7a2f" : "#b3261e"}">${ok ? "Conectado" : "Falhou"}</h1>
  <p>${message}</p>
  <p>Pode fechar esta aba.</p>
  </body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function redirectForAuthError(origin: string, error: AdminAuthorizationError): NextResponse {
  if (error.code === "IDENTITY_REQUIRED" || error.code === "SESSION_REQUIRED") {
    return NextResponse.redirect(new URL("/admin/login", origin));
  }
  if (error.code === "MFA_REQUIRED") {
    return NextResponse.redirect(new URL("/admin/mfa", origin));
  }
  return NextResponse.redirect(new URL("/admin/access-denied", origin));
}

function clearOlistOAuthCookies(response: NextResponse, isProduction: boolean): void {
  const expired = { httpOnly: true, secure: isProduction, sameSite: "lax" as const, path: "/api/admin/olist/oauth", maxAge: 0 };
  response.cookies.set(OLIST_OAUTH_STATE_COOKIE, "", expired);
  response.cookies.set(OLIST_OAUTH_APP_COOKIE, "", expired);
}

export async function GET(request: Request): Promise<Response> {
  const isProduction = isProductionRuntime();
  const siteOrigin = getOlistAdminOrigin(isProduction ? "production" : "staging");

  try {
    await requireAdminPermission("olist.oauth.manage");
  } catch (error) {
    if (error instanceof AdminAuthorizationError) return redirectForAuthError(siteOrigin, error);
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OLIST_OAUTH_STATE_COOKIE)?.value ?? "";
  const app = cookieStore.get(OLIST_OAUTH_APP_COOKIE)?.value;

  const failure = (message: string): NextResponse => {
    const response = statusPage(message, false);
    clearOlistOAuthCookies(response, isProduction);
    return response;
  };

  if (!code || !returnedState || !expectedState || !safeOAuthEqual(returnedState, expectedState)) {
    return failure("Estado da autorização inválido ou expirado (OLIST_OAUTH_STATE_INVALID). Tente conectar de novo.");
  }
  if (!isValidOlistOAuthApp(app)) {
    return failure("Não foi possível identificar qual app estava sendo conectado (OLIST_OAUTH_APP_MISSING). Tente conectar de novo.");
  }

  const environment = isProduction ? "production" : "staging";
  const role = "persi_app" as const;

  try {
    await completeOlistOAuthAuthorization({ role, app, environment, code });
  } catch {
    return failure("A troca do código de autorização pelo token falhou (OLIST_OAUTH_TOKEN_EXCHANGE_FAILED). Confirme o client_id/secret salvos e tente de novo.");
  }

  const response = statusPage(`App "${app}" conectado com sucesso ao ambiente ${environment}.`, true);
  clearOlistOAuthCookies(response, isProduction);
  return response;
}
