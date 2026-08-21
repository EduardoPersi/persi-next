import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import {
  CheckoutIdentityServiceError,
  getCheckoutIdentityDiagnostics,
  requestCheckoutIdentity,
} from "@/services/checkout/checkoutIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  const diagnostics = getCheckoutIdentityDiagnostics();
  if (!diagnostics.wordpressUrlConfigured || !diagnostics.secretConfigured) {
    return NextResponse.json(
      {
        checkoutAuthConfigured: false,
        endpointHost: diagnostics.endpointHost || null,
        secretConfigured: diagnostics.secretConfigured,
        keyId: diagnostics.keyId,
        wordpressReachable: false,
        hmacVerified: false,
      },
      { status: 503, headers: getPrivateAccountHeaders() },
    );
  }

  const secret = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET ?? "";
  const fingerprint = createHmac("sha256", secret)
    .update("checkout-auth-health")
    .digest("hex");
  try {
    const result = await requestCheckoutIdentity(
      "/checkout-auth/health",
      "{}",
      fingerprint,
    );
    const body = result.body as Record<string, unknown> | null;
    return NextResponse.json(
      {
        checkoutAuthConfigured: true,
        endpointHost: diagnostics.endpointHost,
        secretConfigured: true,
        keyId: diagnostics.keyId,
        wordpressReachable: true,
        wordpressStatus: result.status,
        durationMs: result.durationMs,
        hmacVerified: result.status === 200 && body?.hmac_verified === true,
        pluginVersion: typeof body?.plugin_version === "string" ? body.plugin_version : null,
      },
      {
        status: result.status === 200 && body?.hmac_verified === true ? 200 : 503,
        headers: getPrivateAccountHeaders(),
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        checkoutAuthConfigured: true,
        endpointHost: diagnostics.endpointHost,
        secretConfigured: true,
        keyId: diagnostics.keyId,
        wordpressReachable: false,
        hmacVerified: false,
        category: error instanceof CheckoutIdentityServiceError
          ? error.category
          : "next_internal_error",
      },
      { status: 503, headers: getPrivateAccountHeaders() },
    );
  }
}
