export interface NewsletterSubscription {
  email: string;
  consent: true;
  website: string;
  privacyPolicyVersion: string;
  privacyPolicyUrl: string;
}

export type NewsletterResult = { status: "success" };

export class NewsletterError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "NewsletterError";
    this.status = status;
  }
}

export const DEFAULT_NEWSLETTER_ENDPOINT =
  "https://loja.persimateriais.com.br/wp-json/persi/v1/newsletter/subscribe";

export function getNewsletterEndpoint(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    environment.WORDPRESS_NEWSLETTER_ENDPOINT?.trim() ||
    DEFAULT_NEWSLETTER_ENDPOINT;
  let endpoint: URL;
  try {
    endpoint = new URL(configured);
  } catch {
    throw new NewsletterError("Endpoint de newsletter inválido.", 503);
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "loja.persimateriais.com.br" ||
    endpoint.pathname !== "/wp-json/persi/v1/newsletter/subscribe" ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new NewsletterError("Endpoint de newsletter inválido.", 503);
  }
  return endpoint.toString();
}
export function getNewsletterHmacConfig(environment:NodeJS.ProcessEnv=process.env):NewsletterHmacConfig {
  const secret=environment.PERSI_HEADLESS_NEWSLETTER_HMAC_SECRET?.trim();
  const keyId=environment.PERSI_HEADLESS_NEWSLETTER_HMAC_KEY_ID?.trim();
  // PERSI_HEADLESS_NEWSLETTER_FRONTEND_URL é o nome usado no deploy de
  // produção para o mesmo valor; PERSI_HEADLESS_NEWSLETTER_ORIGIN é o nome
  // usado localmente e pelas demais integrações (account/checkout) — aceita
  // os dois para não depender de qual foi provisionado.
  const origin=(environment.PERSI_HEADLESS_NEWSLETTER_ORIGIN?.trim()||environment.PERSI_HEADLESS_NEWSLETTER_FRONTEND_URL?.trim());
  if(!secret||!keyId||!origin||!/^[A-Za-z0-9._-]{1,40}$/.test(keyId)) throw new NewsletterError("Configuração HMAC indisponível.",503);
  let parsed:URL;try{parsed=new URL(origin);}catch{throw new NewsletterError("Origem HMAC inválida.",503);}
  if(parsed.protocol!=="https:"||parsed.origin!==origin.replace(/\/$/,"")||parsed.pathname!=="/"||parsed.search||parsed.hash)throw new NewsletterError("Origem HMAC inválida.",503);
  return {secret,keyId,origin:parsed.origin};
}

export async function subscribeToNewsletter(
  subscription: NewsletterSubscription,
  options: { endpoint?: string; fetchImplementation?: typeof fetch; hmacConfig?: NewsletterHmacConfig } = {},
): Promise<NewsletterResult> {
  const endpoint = options.endpoint ?? getNewsletterEndpoint();
  const config=options.hmacConfig??getNewsletterHmacConfig();
  const rawBody=JSON.stringify(subscription);
  const path="/wp-json/persi/v1/newsletter/subscribe";
  const signed=signNewsletterRequest({path,rawBody},config);

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
      throw new NewsletterError(
        "O WordPress não concluiu a inscrição na newsletter.",
        response.status >= 500 ? 502 : response.status,
      );
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof NewsletterError) {
      throw error;
    }

    throw new NewsletterError(
      "Não foi possível acessar o serviço de newsletter.",
    );
  }
}

export async function submitNewsletterToken(action:"confirm"|"unsubscribe",token:string,options:{fetchImplementation?:typeof fetch}={}) {
  const endpoint=new URL(getNewsletterEndpoint());
  const path=`/wp-json/persi/v1/newsletter/${action}`;
  const rawBody=JSON.stringify({token});
  const signed=signNewsletterRequest({path,rawBody},getNewsletterHmacConfig());
  const response=await (options.fetchImplementation??fetch)(`${endpoint.origin}${path}`,{method:"POST",headers:{"Content-Type":"application/json",...signed.headers},body:rawBody,cache:"no-store",signal:AbortSignal.timeout(10_000)});
  return {ok:response.ok};
}
import { signNewsletterRequest, type NewsletterHmacConfig } from "../../lib/newsletter/hmac.ts";
