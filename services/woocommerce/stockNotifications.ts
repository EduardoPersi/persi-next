export interface StockNotificationSubscription {
  productId: number;
  variationId?: number;
  email: string;
  consent: true;
  website: string;
  privacyPolicyVersion: string;
  privacyPolicyUrl: string;
}

export type StockNotificationResult =
  | { status: "success" }
  | { status: "already_registered" };

export class StockNotificationError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "StockNotificationError";
    this.status = status;
  }
}

export const DEFAULT_STOCK_NOTIFICATION_ENDPOINT =
  "https://loja.persimateriais.com.br/wp-json/persi/v1/stock-notifications/subscribe";

export function getStockNotificationEndpoint(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    environment.WORDPRESS_STOCK_NOTIFICATION_ENDPOINT?.trim() ||
    DEFAULT_STOCK_NOTIFICATION_ENDPOINT;
  let endpoint: URL;
  try {
    endpoint = new URL(configured);
  } catch {
    throw new StockNotificationError("Endpoint de aviso de estoque inválido.", 503);
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "loja.persimateriais.com.br" ||
    endpoint.pathname !== "/wp-json/persi/v1/stock-notifications/subscribe" ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new StockNotificationError("Endpoint de aviso de estoque inválido.", 503);
  }
  return endpoint.toString();
}
export function getStockHmacConfig(environment:NodeJS.ProcessEnv=process.env):StockHmacConfig {
  const secret=environment.PERSI_HEADLESS_STOCK_HMAC_SECRET?.trim();
  const keyId=environment.PERSI_HEADLESS_STOCK_HMAC_KEY_ID?.trim();
  const origin=environment.PERSI_HEADLESS_STOCK_ORIGIN?.trim();
  if(!secret||!keyId||!origin||!/^[A-Za-z0-9._-]{1,40}$/.test(keyId)) throw new StockNotificationError("Configuração HMAC indisponível.",503);
  let parsed:URL;try{parsed=new URL(origin);}catch{throw new StockNotificationError("Origem HMAC inválida.",503);}
  if(parsed.protocol!=="https:"||parsed.origin!==origin.replace(/\/$/,"")||parsed.pathname!=="/"||parsed.search||parsed.hash)throw new StockNotificationError("Origem HMAC inválida.",503);
  return {secret,keyId,origin:parsed.origin};
}

export async function subscribeToBackInStockNotification(
  subscription: StockNotificationSubscription,
  options: { endpoint?: string; fetchImplementation?: typeof fetch; hmacConfig?: StockHmacConfig } = {},
): Promise<StockNotificationResult> {
  const endpoint = options.endpoint ?? getStockNotificationEndpoint();
  const config=options.hmacConfig??getStockHmacConfig();
  const rawBody=JSON.stringify(subscription);
  const path="/wp-json/persi/v1/stock-notifications/subscribe";
  const signed=signStockRequest({path,rawBody},config);

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

    if (response.status === 409) {
      return { status: "already_registered" };
    }

    if (!response.ok) {
      throw new StockNotificationError(
        "O WordPress não concluiu o cadastro do aviso de estoque.",
        response.status >= 500 ? 502 : response.status,
      );
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof StockNotificationError) {
      throw error;
    }

    throw new StockNotificationError(
      "Não foi possível acessar o serviço de aviso de estoque.",
    );
  }
}

export async function submitStockToken(action:"confirm"|"unsubscribe",token:string,options:{fetchImplementation?:typeof fetch}={}) {
  const endpoint=new URL(getStockNotificationEndpoint());
  const path=`/wp-json/persi/v1/stock-notifications/${action}`;
  const rawBody=JSON.stringify({token});
  const signed=signStockRequest({path,rawBody},getStockHmacConfig());
  const response=await (options.fetchImplementation??fetch)(`${endpoint.origin}${path}`,{method:"POST",headers:{"Content-Type":"application/json",...signed.headers},body:rawBody,cache:"no-store",signal:AbortSignal.timeout(10_000)});
  return {ok:response.ok};
}
import { signStockRequest, type StockHmacConfig } from "../../lib/stock-notifications/hmac.ts";
