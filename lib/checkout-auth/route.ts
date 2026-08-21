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
      return json(
        {
          message: typeof upstreamBody?.message === "string"
            ? upstreamBody.message
            : "Não foi possível continuar agora.",
          code: typeof upstreamBody?.code === "string" ? upstreamBody.code : undefined,
          retryAfter: Number(upstream.retryAfter ?? upstreamBody?.retry_after ?? 0) || undefined,
        },
        [400, 401, 404, 409, 429, 503].includes(upstream.status)
          ? upstream.status
          : 502,
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
    return json({ message: "Não foi possível acessar o serviço de identificação." }, 503);
  }
}
