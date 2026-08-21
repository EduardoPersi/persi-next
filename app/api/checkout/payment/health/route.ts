import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPrivateCartHeaders } from "@/lib/commerce/cartResponsePolicy";
import { healthCheckoutAttempt } from "@/lib/commerce/checkoutAttempt";
import { getPublicCheckoutCapabilities } from "@/lib/commerce/checkoutConfig";
import {
  getInterConfigurationDiagnostics,
  verifyInterAuthentication,
} from "@/services/payments/inter/client";
import { InterPaymentError } from "@/services/payments/inter/errors";
import { getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import { getPixChargeStatus } from "@/services/payments/inter/pix";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const configured = process.env.CHECKOUT_STAGING_DRY_RUN_SECRET?.trim();
  const received = request.headers.get("x-persi-staging-dry-run")?.trim();
  if (!configured || !received) return false;
  const expectedBuffer = Buffer.from(configured);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function verifiesMissingReference(
  request: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await request();
    return false;
  } catch (error) {
    return error instanceof InterPaymentError && error.status === 404;
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { code: "NOT_FOUND" },
      { status: 404, headers: getPrivateCartHeaders() },
    );
  }

  const startedAt = Date.now();
  const configuration = getInterConfigurationDiagnostics();
  const capabilities = getPublicCheckoutCapabilities();
  let oauthAuthenticated = false;
  let attemptHealth = null;

  try {
    await verifyInterAuthentication();
    oauthAuthenticated = true;
  } catch {}

  try {
    attemptHealth = await healthCheckoutAttempt();
  } catch {}

  const [pixReadAuthorized, boletoReadAuthorized] = oauthAuthenticated
    ? await Promise.all([
        verifiesMissingReference(() =>
          getPixChargeStatus("DIAGNOSTICOSEGURO12345678901234"),
        ),
        verifiesMissingReference(() =>
          getBoletoChargeStatus("00000000-0000-4000-8000-000000000000"),
        ),
      ])
    : [false, false];

  const healthy = Boolean(
    capabilities.pix &&
      capabilities.boleto &&
      configuration.interClientIdConfigured &&
      configuration.interSecretConfigured &&
      configuration.interCertificateValid &&
      configuration.interPrivateKeyValid &&
      configuration.interCertificateKeyPairValid &&
      configuration.interPixKeyConfigured &&
      oauthAuthenticated &&
      attemptHealth?.healthy &&
      attemptHealth.tableExists &&
      attemptHealth.uniqueCheckoutAttemptId &&
      pixReadAuthorized &&
      boletoReadAuthorized,
  );

  return NextResponse.json(
    {
      healthy,
      checkoutMode: "next",
      pixEnabled: capabilities.pix,
      boletoEnabled: capabilities.boleto,
      cardEnabled: capabilities.card,
      ...configuration,
      oauthAuthenticated,
      pixReadAuthorized,
      boletoReadAuthorized,
      checkoutAttempt: attemptHealth,
      durationMs: Date.now() - startedAt,
    },
    {
      status: healthy ? 200 : 503,
      headers: getPrivateCartHeaders(),
    },
  );
}
