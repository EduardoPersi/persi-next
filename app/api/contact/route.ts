import { after, NextRequest, NextResponse } from "next/server";
import {
  ContactError,
  submitContactMessage,
} from "@/services/woocommerce/contact";
import { contactSubmissionSchema } from "@/lib/validation/contact";
import { getRequestIp, verifyRecaptcha } from "@/lib/recaptcha/verify";
import { createRateLimiter } from "@/lib/network/rateLimit";
import { enviarLeadAoPainel, montarCorpoDoLead } from "@/lib/painel/lead";
import { lerOrigemDosCookies } from "@/lib/tracking/servidor";
import { SITE_URL } from "@/lib/routing/storefrontUrls";
import { CONTACT_SUBJECTS } from "@/lib/validation/contact";

const RECAPTCHA_ACTION = "contact_submit";

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

  // O formulário também vira lead no painel. Fica FORA do try do envio e roda
  // depois da resposta (`after`): painel lento, fora do ar ou recusando não
  // atrasa nem derruba o formulário. Já valido e com recaptcha aprovado — não
  // vai lixo de robô ao painel. Falha vai ao log, sem dados pessoais.
  const subjectLabel =
    CONTACT_SUBJECTS.find((subject) => subject.value === parsed.data.subject)?.label ??
    parsed.data.subject;
  const origem = (() => {
    try {
      return lerOrigemDosCookies((nome) => request.cookies.get(nome)?.value);
    } catch {
      return undefined;
    }
  })();
  const leadBody = montarCorpoDoLead({
    contato: {
      nome: parsed.data.name,
      email: parsed.data.email,
      mensagem: `[${subjectLabel}] ${parsed.data.message}`,
    },
    consentimentoMarketing: parsed.data.marketingConsent,
    origem,
    pagina: `${SITE_URL}/contato`,
    formulario: "Contato do site",
  });
  after(() => enviarLeadAoPainel(leadBody).then(() => undefined));

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
