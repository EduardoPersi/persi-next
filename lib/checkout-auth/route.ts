import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { AUTH_COOKIE_NAME, getAuthCookieOptions } from "@/lib/auth/cookies";
import { getAuthenticatedUser } from "@/lib/auth/user";
import { isJwtFormat } from "@/lib/auth/token";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import {
  CheckoutIdentityValidationError,
  parseCheckoutIdentityPayload,
  type CheckoutIdentityAction,
} from "./validation";
import { getAccountClientConfig } from "@/services/account/client";
import {
  CheckoutIdentityServiceError,
  getCheckoutIdentityDiagnostics,
  requestCheckoutIdentity,
  type CheckoutIdentityRoute,
} from "@/services/checkout/checkoutIdentity";
import { isJsonContentType, validateMutationSource } from "@/lib/account/validation";

const ROUTES: Record<CheckoutIdentityAction, CheckoutIdentityRoute> = {
  identify: "/checkout-auth/identify",
  password: "/checkout-auth/password",
  "code-request": "/checkout-auth/code/request",
  "code-verify": "/checkout-auth/code/verify",
};

function httpCategory(status: number, code?: unknown): string {
  if (code === "persi_checkout_auth_expired") return "hmac_timestamp_expired";
  if (code === "persi_checkout_auth_replay") return "hmac_nonce_reused";
  if (code === "persi_checkout_auth_signature") return "hmac_signature_invalid";
  if (code === "persi_checkout_auth_unauthorized") return "hmac_configuration_or_key_invalid";
  if (code === "wp_die" && status >= 500) return "wordpress_php_or_database_error";
  if (status >= 300 && status < 400) return "wordpress_redirect";
  if (status === 401) return "wordpress_unauthorized";
  if (status === 403) return "wordpress_forbidden";
  if (status === 404) return "wordpress_route_missing";
  if (status >= 500) return "wordpress_server_error";
  return "wordpress_http_error";
}

function logFailure(input: {
  action: CheckoutIdentityAction;
  category: string;
  durationMs?: number;
  status?: number;
}) {
  const diagnostics = getCheckoutIdentityDiagnostics();
  console.error("[checkout-identity]", {
    action: input.action,
    endpoint: diagnostics.endpointOrigin
      ? `${diagnostics.endpointOrigin}/wp-json/persi-headless/v1${ROUTES[input.action]}`
      : "unconfigured",
    status: input.status,
    durationMs: input.durationMs,
    category: input.category,
    wordpressUrlConfigured: diagnostics.wordpressUrlConfigured,
    secretConfigured: diagnostics.secretConfigured,
    keyId: diagnostics.keyId,
  });
}

function json(body: unknown, status = 200, retryAfter?: string) {
  const response = NextResponse.json(body, {
    status,
    headers: getPrivateAccountHeaders(),
  });
  if (retryAfter) response.headers.set("Retry-After", retryAfter);
  return response;
}

export async function handleCheckoutIdentityRequest(
  request: Request,
  action: CheckoutIdentityAction,
) {
  try {
    const config = getAccountClientConfig();
    if (!validateMutationSource(request.headers, config.origin)) {
      return json({ message: "Origem da solicitação inválida." }, 403);
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return json({ message: "Formato da solicitação inválido." }, 415);
    }
    const payload = parseCheckoutIdentityPayload(await request.text(), action);
    const rawBody = JSON.stringify(payload);
    const fingerprintSecret = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET ?? "";
    const clientFingerprint = createHmac("sha256", fingerprintSecret)
      .update(`${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""}|${request.headers.get("user-agent") ?? ""}`)
      .digest("hex");
    const upstream = await requestCheckoutIdentity(
      ROUTES[action],
      rawBody,
      clientFingerprint,
    );
    const upstreamBody = upstream.body as Record<string, unknown> | null;

    if (upstream.status < 200 || upstream.status >= 300) {
      logFailure({
        action,
        category: httpCategory(upstream.status, upstreamBody?.code),
        durationMs: upstream.durationMs,
        status: upstream.status,
      });
      const isCredentialFailure =
        action !== "identify" && [400, 401, 409, 429].includes(upstream.status);
      return json(
        {
          message: isCredentialFailure && typeof upstreamBody?.message === "string"
            ? upstreamBody.message
            : upstream.status === 429
              ? "Muitas tentativas. Aguarde e tente novamente."
              : "Não conseguimos verificar seu e-mail agora. Tente novamente em alguns instantes.",
          code: isCredentialFailure && typeof upstreamBody?.code === "string"
            ? upstreamBody.code
            : undefined,
          retryAfter: Number(upstream.retryAfter ?? upstreamBody?.retry_after ?? 0) || undefined,
        },
        upstream.status === 429 ? 429 : isCredentialFailure ? upstream.status : 503,
        upstream.retryAfter,
      );
    }

    if (action !== "password" && action !== "code-verify") {
      return json(upstreamBody ?? {});
    }

    const token = typeof upstreamBody?.token === "string" ? upstreamBody.token : "";
    const expiresAt = typeof upstreamBody?.expires_at === "string"
      ? upstreamBody.expires_at
      : "";
    if (!isJwtFormat(token) || !Number.isFinite(Date.parse(expiresAt))) {
      return json({ message: "A sessão retornada é inválida." }, 502);
    }
    const user = await getAuthenticatedUser(token);
    const response = json({
      authenticated: true,
      expiresAt,
      customer: {
        id: user.id,
        firstName: user.firstName,
        displayName: user.displayName,
        email: user.email,
        roles: user.roles,
        avatar: user.avatar,
        permissions: user.permissions,
        authenticated: true,
        jwtExpiration: expiresAt,
      },
    });
    response.cookies.set(AUTH_COOKIE_NAME, token, getAuthCookieOptions(expiresAt));
    return response;
  } catch (error) {
    if (error instanceof CheckoutIdentityValidationError) {
      return json({ message: error.message }, 400);
    }
    const category = error instanceof CheckoutIdentityServiceError
      ? error.category
      : "next_internal_error";
    logFailure({
      action,
      category,
      durationMs: error instanceof CheckoutIdentityServiceError
        ? error.durationMs
        : undefined,
    });
    return json(
      {
        message: category === "timeout"
          ? "A verificação está demorando mais que o esperado. Tente novamente."
          : "Não conseguimos verificar seu e-mail agora. Tente novamente em alguns instantes.",
      },
      category === "timeout" ? 504 : 503,
    );
  }
}
