import { NextRequest, NextResponse } from "next/server";
import {
  ContactError,
  submitContactMessage,
} from "@/services/woocommerce/contact";
import { contactSubmissionSchema } from "@/lib/validation/contact";
import { getRequestIp, verifyRecaptcha } from "@/lib/recaptcha/verify";

const RECAPTCHA_ACTION = "contact_submit";

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

  const parsed = contactSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "validation_error",
        message: "Confira os dados informados no formulário.",
      },
      { status: 400 },
    );
  }

  const { band } = await verifyRecaptcha({
    token: parsed.data.recaptchaToken,
    action: RECAPTCHA_ACTION,
    form: "contact",
    ip: getRequestIp(request.headers),
  });
  if (band === "reject") {
    return NextResponse.json(
      { code: "validation_error", message: "Não foi possível enviar sua mensagem." },
      { status: 400 },
    );
  }

  try {
    await submitContactMessage({
      name: parsed.data.name,
      email: parsed.data.email,
      subject: parsed.data.subject,
      message: parsed.data.message,
    });

    return NextResponse.json({
      code: "success",
      message: "Mensagem enviada! Em breve entraremos em contato.",
    });
  } catch (error) {
    const status = error instanceof ContactError ? error.status : 500;

    return NextResponse.json(
      {
        code: status === 503 ? "integration_not_configured" : "submission_error",
        message:
          status === 503
            ? "O formulário de contato ainda está sendo configurado. Fale com a gente pelo WhatsApp."
            : "Não foi possível enviar sua mensagem. Tente novamente.",
      },
      { status },
    );
  }
}
