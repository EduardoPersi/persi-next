import { signContactRequest, type ContactHmacConfig } from "../../lib/contact/hmac.ts";
import type { ContactFormValues } from "../../lib/validation/contact.ts";

export type ContactMessage = Omit<ContactFormValues, "website">;

export type ContactResult = { status: "success" };

export class ContactError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ContactError";
    this.status = status;
  }
}

export const DEFAULT_CONTACT_ENDPOINT =
  "https://loja.persimateriais.com.br/wp-json/persi/v1/contact/submit";

export function getContactEndpoint(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    environment.WORDPRESS_CONTACT_ENDPOINT?.trim() || DEFAULT_CONTACT_ENDPOINT;
  let endpoint: URL;
  try {
    endpoint = new URL(configured);
  } catch {
    throw new ContactError("Endpoint de contato inválido.", 503);
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "loja.persimateriais.com.br" ||
    endpoint.pathname !== "/wp-json/persi/v1/contact/submit" ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new ContactError("Endpoint de contato inválido.", 503);
  }
  return endpoint.toString();
}

export function getContactHmacConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ContactHmacConfig {
  const secret = environment.PERSI_HEADLESS_CONTACT_HMAC_SECRET?.trim();
  const keyId = environment.PERSI_HEADLESS_CONTACT_HMAC_KEY_ID?.trim();
  // PERSI_HEADLESS_CONTACT_ORIGIN nunca foi provisionada em produção — cai
  // para APP_BASE_URL, que já existe e representa a mesma origem pública
  // do front-end usada pelas demais integrações (account/checkout).
  const origin =
    environment.PERSI_HEADLESS_CONTACT_ORIGIN?.trim() ||
    environment.PERSI_HEADLESS_CONTACT_FRONTEND_URL?.trim() ||
    environment.APP_BASE_URL?.trim();
  if (
    !secret ||
    !keyId ||
    !origin ||
    !/^[A-Za-z0-9._-]{1,40}$/.test(keyId)
  ) {
    throw new ContactError("Configuração HMAC indisponível.", 503);
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ContactError("Origem HMAC inválida.", 503);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin.replace(/\/$/, "") ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ContactError("Origem HMAC inválida.", 503);
  }
  return { secret, keyId, origin: parsed.origin };
}

export async function submitContactMessage(
  message: ContactMessage,
  options: {
    endpoint?: string;
    fetchImplementation?: typeof fetch;
    hmacConfig?: ContactHmacConfig;
  } = {},
): Promise<ContactResult> {
  const endpoint = options.endpoint ?? getContactEndpoint();
  const config = options.hmacConfig ?? getContactHmacConfig();
  const rawBody = JSON.stringify(message);
  const path = "/wp-json/persi/v1/contact/submit";
  const signed = signContactRequest({ path, rawBody }, config);

  try {
    const response = await (options.fetchImplementation ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...signed.headers,
      },
      body: rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new ContactError(
        "O WordPress não concluiu o envio da mensagem.",
        response.status >= 500 ? 502 : response.status,
      );
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof ContactError) {
      throw error;
    }

    throw new ContactError("Não foi possível acessar o serviço de contato.");
  }
}
