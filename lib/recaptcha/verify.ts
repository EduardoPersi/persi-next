import { createHash } from "node:crypto";

export type RecaptchaBand = "accept" | "gray" | "reject";

export interface RecaptchaVerification {
  band: RecaptchaBand;
  score: number | null;
}

const SITEVERIFY_ENDPOINT = "https://www.google.com/recaptcha/api/siteverify";

let warnedMissingConfig = false;

function getThreshold(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function verifyRecaptcha(input: {
  token: string | null;
  action: string;
  form: string;
  ip: string;
  fetchImplementation?: typeof fetch;
}): Promise<RecaptchaVerification> {
  const secret = process.env.RECAPTCHA_SECRET_KEY?.trim();
  if (!secret) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        "[recaptcha] RECAPTCHA_SECRET_KEY não configurada — verificação desativada, formulários seguem sem proteção antibot.",
      );
    }
    return { band: "accept", score: null };
  }

  const low = getThreshold("RECAPTCHA_SCORE_LOW", 0.3);
  const high = getThreshold("RECAPTCHA_SCORE_HIGH", 0.5);
  const ipHash = input.ip ? hashIp(input.ip) : null;

  if (!input.token) {
    // Sem token não é prova de bot — o navegador pode ter falhado em gerar um
    // por motivo alheio ao visitante (script bloqueado, domínio não
    // cadastrado no reCAPTCHA, instabilidade do Google). Bloquear aqui
    // derrubaria o formulário inteiro por qualquer uma dessas causas; trata
    // como zona cinzenta e deixa a barreira de cada fluxo (double opt-in ou
    // rate limit) ser o backstop real.
    console.log("[recaptcha]", {
      form: input.form,
      action: input.action,
      success: false,
      score: null,
      band: "gray" satisfies RecaptchaBand,
      reason: "no_token",
      hostname: null,
      ipHash,
    });
    return { band: "gray", score: null };
  }

  try {
    const response = await (input.fetchImplementation ?? fetch)(SITEVERIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: input.token,
        remoteip: input.ip,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      score?: number;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    } | null;

    const success = Boolean(body?.success) && body?.action === input.action;
    const score = typeof body?.score === "number" ? body.score : null;
    const band: RecaptchaBand =
      !success || score === null
        ? "reject"
        : score < low
          ? "reject"
          : score < high
            ? "gray"
            : "accept";

    console.log("[recaptcha]", {
      form: input.form,
      action: input.action,
      success,
      score,
      band,
      hostname: body?.hostname ?? null,
      ipHash,
      errorCodes: body?.["error-codes"] ?? undefined,
    });

    return { band, score };
  } catch {
    console.log("[recaptcha]", {
      form: input.form,
      action: input.action,
      success: false,
      score: null,
      band: "gray" satisfies RecaptchaBand,
      reason: "network_error",
      hostname: null,
      ipHash,
    });
    return { band: "gray", score: null };
  }
}

// cf-connecting-ip é definido pelo Cloudflare (que fica na frente dos dois
// domínios) e não pode ser forjado pelo cliente — o Cloudflare sobrescreve
// esse header em todo request que passa por ele. x-forwarded-for e
// x-real-ip ficam só como fallback para tráfego que não passar pelo
// Cloudflare (ex.: chamada direta ao servidor de origem), mas um cliente
// pode enviar qualquer valor nesses dois, então não servem para limitar
// abuso sozinhos.
export function getRequestIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    ""
  );
}
