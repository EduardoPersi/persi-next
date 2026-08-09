import { NextRequest, NextResponse } from "next/server";
import {
  NewsletterError,
  subscribeToNewsletter,
  getNewsletterHmacConfig,
} from "@/services/woocommerce/newsletter";
import {
  parseBrowserNewsletterSubscription,
  NEWSLETTER_POLICY_PATH,
  NEWSLETTER_POLICY_VERSION,
} from "@/lib/newsletter/validation";
import { getRequestIp, verifyRecaptcha } from "@/lib/recaptcha/verify";

const RECAPTCHA_ACTION = "newsletter_subscribe";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const requestLog = new Map<string, number[]>();
function isRateLimited(request: NextRequest): boolean {
  const now = Date.now();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const recentRequests = (requestLog.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  recentRequests.push(now);
  requestLog.set(ip, recentRequests);

  return recentRequests.length > RATE_LIMIT_MAX_REQUESTS;
}

export async function POST(request: NextRequest) {
  if (isRateLimited(request)) {
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
    parsed = parseBrowserNewsletterSubscription(body);
  } catch {
    parsed = undefined;
  }

  if (!parsed) {
    return NextResponse.json(
      {
        code: "validation_error",
        message: "Confira o e-mail informado.",
      },
      { status: 400 },
    );
  }

  const { band } = await verifyRecaptcha({
    token: parsed.recaptchaToken,
    action: RECAPTCHA_ACTION,
    form: "newsletter",
    ip: getRequestIp(request.headers),
  });
  if (band === "reject") {
    return NextResponse.json(
      { code: "validation_error", message: "Não foi possível concluir a inscrição." },
      { status: 400 },
    );
  }

  try {
    const origin = getNewsletterHmacConfig().origin;
    const subscription = {
      email: parsed.email,
      consent: parsed.consent,
      website: parsed.website,
      privacyPolicyVersion: NEWSLETTER_POLICY_VERSION,
      privacyPolicyUrl: `${origin}${NEWSLETTER_POLICY_PATH}`,
    };
    await subscribeToNewsletter(subscription);

    return NextResponse.json({
      code: "success",
      message: "Confira seu e-mail para confirmar a inscrição.",
    });
  } catch (error) {
    const status = error instanceof NewsletterError ? error.status : 500;

    return NextResponse.json(
      {
        code:
          status === 503 ? "integration_not_configured" : "subscription_error",
        message:
          status === 503
            ? "A integração de newsletter ainda está pendente."
            : "Não foi possível concluir a inscrição. Tente novamente.",
      },
      { status },
    );
  }
}
