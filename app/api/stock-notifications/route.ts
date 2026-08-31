import { NextRequest, NextResponse } from "next/server";
import {
  StockNotificationError,
  subscribeToBackInStockNotification,
} from "@/services/woocommerce/stockNotifications";
import {
  parseBrowserStockSubscription,
  STOCK_POLICY_PATH,
  STOCK_POLICY_VERSION,
} from "@/lib/stock-notifications/validation";
import { getStockHmacConfig } from "@/services/woocommerce/stockNotifications";
import { getRequestIp, verifyRecaptcha } from "@/lib/recaptcha/verify";
import { createRateLimiter } from "@/lib/network/rateLimit";

const RECAPTCHA_ACTION = "stock_notification_subscribe";

const rateLimiter = createRateLimiter(10 * 60 * 1000, 5);

export async function POST(request: NextRequest) {
  if (rateLimiter.isLimited(request.headers)) {
    return NextResponse.json(
      {
        code: "rate_limited",
        message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      },
      { status: 429 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: "Dados inválidos." },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = parseBrowserStockSubscription(body);
  } catch {
    parsed = undefined;
  }

  if (!parsed) {
    return NextResponse.json(
      {
        code: "validation_error",
        message: "Confira o e-mail, o consentimento e o produto informado.",
      },
      { status: 400 },
    );
  }

  const { band } = await verifyRecaptcha({
    token: parsed.recaptchaToken,
    action: RECAPTCHA_ACTION,
    form: "stock-notifications",
    ip: getRequestIp(request.headers),
  });
  if (band === "reject") {
    return NextResponse.json(
      { code: "validation_error", message: "Não foi possível concluir o cadastro." },
      { status: 400 },
    );
  }

  try {
    const origin = getStockHmacConfig().origin;
    const subscription = {
      productId: parsed.productId,
      variationId: parsed.variationId,
      email: parsed.email,
      consent: parsed.consent,
      website: parsed.website,
      privacyPolicyVersion: STOCK_POLICY_VERSION,
      privacyPolicyUrl: `${origin}${STOCK_POLICY_PATH}`,
    };
    const result =
      await subscribeToBackInStockNotification(subscription);

    if (result.status === "already_registered") {
      return NextResponse.json(
        {
          code: "already_registered",
          message: "Este e-mail já está cadastrado para este produto.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      code: "success",
      message:
        "Cadastro realizado. Avisaremos quando este produto voltar ao estoque.",
    });
  } catch (error) {
    const status =
      error instanceof StockNotificationError ? error.status : 500;

    return NextResponse.json(
      {
        code:
          status === 503
            ? "integration_not_configured"
            : "subscription_error",
        message:
          status === 503
            ? "A integração de aviso de estoque ainda está pendente."
            : "Não foi possível concluir o cadastro. Tente novamente.",
      },
      { status },
    );
  }
}
