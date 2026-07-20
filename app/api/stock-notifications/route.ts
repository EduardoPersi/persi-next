import { NextRequest, NextResponse } from "next/server";
import {
  StockNotificationError,
  subscribeToBackInStockNotification,
} from "@/services/woocommerce/stockNotifications";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const requestLog = new Map<string, number[]>();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParsedSubscription {
  productId: number;
  variationId?: number;
  email: string;
  consent: true;
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : undefined;
}

function parseSubscription(value: unknown): ParsedSubscription | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const body = value as Record<string, unknown>;
  const productId = parsePositiveInteger(body.productId);
  const variationId =
    body.variationId === undefined
      ? undefined
      : parsePositiveInteger(body.variationId);
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (
    !productId ||
    (body.variationId !== undefined && !variationId) ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    body.consent !== true
  ) {
    return undefined;
  }

  return { productId, variationId, email, consent: true };
}

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

  const subscription = parseSubscription(body);

  if (!subscription) {
    return NextResponse.json(
      {
        code: "validation_error",
        message: "Confira o e-mail, o consentimento e o produto informado.",
      },
      { status: 400 },
    );
  }

  try {
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
