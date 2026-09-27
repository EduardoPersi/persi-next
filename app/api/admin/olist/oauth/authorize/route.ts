import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireAdminPermission } from "@/lib/admin/authorization";
import { generateOAuthValue } from "@/lib/account/oauth/state";
import { buildOlistAuthorizationUrl, getOlistOAuthAppConfig } from "@/lib/olist/oauthClient";
import { isProductionRuntime } from "@/lib/runtime/runtime-environment";
import { OLIST_OAUTH_APP_COOKIE, OLIST_OAUTH_COOKIE_MAX_AGE, OLIST_OAUTH_STATE_COOKIE, isValidOlistOAuthApp } from "@/lib/olist/oauthRouteShared";

// Admin-gated, one-time browser authorization flow
// (docs/native-commerce/olist-oauth-flow-design.md Section 2-3). No Olist
// API call happens here -- this route only redirects the admin's own
// browser to Olist's authorization endpoint; the actual code-for-token
// exchange happens in the callback route below, only after the admin
// approves the app on Olist's own page.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function redirectForAuthError(request: Request, error: AdminAuthorizationError): NextResponse {
  if (error.code === "IDENTITY_REQUIRED" || error.code === "SESSION_REQUIRED") {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (error.code === "MFA_REQUIRED") {
    return NextResponse.redirect(new URL("/admin/mfa", request.url));
  }
  return NextResponse.redirect(new URL("/admin/access-denied", request.url));
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminPermission("olist.oauth.manage");
  } catch (error) {
    if (error instanceof AdminAuthorizationError) return redirectForAuthError(request, error);
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const appParam = searchParams.get("app");
  if (!isValidOlistOAuthApp(appParam)) {
    return NextResponse.json({ message: "Parâmetro app inválido (esperado catalogo|pedidos)." }, { status: 400 });
  }

  const isProduction = isProductionRuntime();
  const environment = isProduction ? "production" : "staging";
  // Pedidos nunca deve ser autorizado fora de produção -- o export de
  // pedido em staging é sempre dry_run e não precisa (nem deve ter) essa
  // credencial (olist-integration-design.md Seção 14.1/14.3).
  if (appParam === "pedidos" && !isProduction) {
    return NextResponse.json({ message: "O app Pedidos só pode ser autorizado em produção." }, { status: 403 });
  }

  let config;
  try {
    config = getOlistOAuthAppConfig(appParam, environment);
  } catch {
    return NextResponse.json(
      { message: "Credenciais do app Olist não configuradas neste ambiente (OLIST_SYNC_CLIENT_ID/SECRET ou OLIST_ORDERS_CLIENT_ID/SECRET)." },
      { status: 503 },
    );
  }

  const state = generateOAuthValue();
  const authorizationUrl = buildOlistAuthorizationUrl({ config, state });

  const response = NextResponse.redirect(authorizationUrl);
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/api/admin/olist/oauth",
    maxAge: OLIST_OAUTH_COOKIE_MAX_AGE,
  };
  response.cookies.set(OLIST_OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(OLIST_OAUTH_APP_COOKIE, appParam, cookieOptions);
  return response;
}
