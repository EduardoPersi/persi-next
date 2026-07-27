import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";

const baseUrlValue = process.env.CART_ISOLATION_BASE_URL;
const mode = process.env.CART_ISOLATION_MODE ?? "direct";
const allowMutations =
  process.env.CART_ISOLATION_ALLOW_MUTATIONS === "true";
const useUniqueQuery =
  process.env.CART_ISOLATION_UNIQUE_QUERY !== "false";
const productId = Number(process.env.CART_ISOLATION_PRODUCT_ID);

if (!baseUrlValue) {
  throw new Error("Defina CART_ISOLATION_BASE_URL.");
}

if (mode !== "direct" && mode !== "next") {
  throw new Error('CART_ISOLATION_MODE deve ser "direct" ou "next".');
}

const baseUrl = new URL(baseUrlValue);
function maskSecret(value) {
  if (!value) return null;
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  const visible =
    value.length > 10
      ? `${value.slice(0, 6)}…${value.slice(-4)}`
      : "(valor curto oculto)";
  return { visible, sha256: hash };
}

function hashItemKeys(cart) {
  const keys = Array.isArray(cart?.items)
    ? cart.items
        .map((item) => (typeof item?.key === "string" ? item.key : ""))
        .filter(Boolean)
        .sort()
    : [];
  return createHash("sha256").update(keys.join("|")).digest("hex").slice(0, 12);
}

function getHeader(rawHeaders, name) {
  const normalizedName = name.toLowerCase();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === normalizedName) {
      return rawHeaders[index + 1];
    }
  }
  return null;
}

function getHeaders(rawHeaders, name) {
  const normalizedName = name.toLowerCase();
  const values = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === normalizedName) {
      values.push(rawHeaders[index + 1]);
    }
  }
  return values;
}

function parseCookie(setCookie) {
  const pair = setCookie.split(";", 1)[0];
  const separator = pair.indexOf("=");
  if (separator < 1) return null;
  return {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
  };
}

class IsolatedClient {
  constructor(name) {
    this.name = name;
    this.jar = new Map();
    this.cartToken = null;
    this.agent =
      baseUrl.protocol === "https:"
        ? new https.Agent({ keepAlive: false, maxSockets: 1 })
        : new http.Agent({ keepAlive: false, maxSockets: 1 });
  }

  close() {
    this.agent.destroy();
  }

  cookieHeader() {
    return [...this.jar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  tokenForComparison() {
    if (mode === "direct") return this.cartToken;
    return this.jar.get("persi_cart_token") ?? null;
  }

  async request(pathname, options = {}, redirectChain = []) {
    const url = new URL(pathname, baseUrl);
    const requestHeaders = {
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store",
      Pragma: "no-cache",
      ...options.headers,
    };
    const cookie = this.cookieHeader();
    const sentCookieNames = [...this.jar.keys()];
    const sentCartToken = mode === "direct" && Boolean(this.cartToken);
    if (cookie) requestHeaders.Cookie = cookie;
    if (mode === "direct" && this.cartToken) {
      requestHeaders["Cart-Token"] = this.cartToken;
    }
    if (options.body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
    }

    const response = await new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(
        url,
        {
          method: options.method ?? "GET",
          headers: requestHeaders,
          agent: this.agent,
          timeout: 20_000,
        },
        (incoming) => {
          const chunks = [];
          incoming.on("data", (chunk) => chunks.push(chunk));
          incoming.on("end", () => {
            resolve({
              status: incoming.statusCode ?? 0,
              rawHeaders: incoming.rawHeaders,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("timeout", () => {
        request.destroy(new Error("Timeout da requisição."));
      });
      request.on("error", reject);
      if (options.body !== undefined) {
        request.write(JSON.stringify(options.body));
      }
      request.end();
    });

    const setCookies = getHeaders(response.rawHeaders, "set-cookie");
    for (const header of setCookies) {
      const parsed = parseCookie(header);
      if (parsed) this.jar.set(parsed.name, parsed.value);
    }
    const responseToken = getHeader(response.rawHeaders, "cart-token");
    if (responseToken) this.cartToken = responseToken;

    if (
      response.status >= 300 &&
      response.status < 400 &&
      redirectChain.length < 5
    ) {
      const location = getHeader(response.rawHeaders, "location");
      if (location) {
        return this.request(
          new URL(location, url).toString(),
          { method: "GET" },
          [...redirectChain, { status: response.status, from: url.toString() }],
        );
      }
    }

    let payload = null;
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = null;
    }

    return {
      status: response.status,
      requestedUrl: url.toString(),
      finalUrl: url.toString(),
      redirects: redirectChain,
      payload,
      headers: {
        age: getHeader(response.rawHeaders, "age"),
        cacheControl: getHeader(response.rawHeaders, "cache-control"),
        cfCacheStatus: getHeader(response.rawHeaders, "cf-cache-status"),
        server: getHeader(response.rawHeaders, "server"),
        vary: getHeader(response.rawHeaders, "vary"),
        etag: getHeader(response.rawHeaders, "etag"),
        xLiteSpeedCache: getHeader(response.rawHeaders, "x-litespeed-cache"),
        xLiteSpeedCacheControl: getHeader(
          response.rawHeaders,
          "x-litespeed-cache-control",
        ),
        xCache: getHeader(response.rawHeaders, "x-cache"),
        xProxyCache: getHeader(response.rawHeaders, "x-proxy-cache"),
        xHostingerCache: getHeader(response.rawHeaders, "x-hostinger-cache"),
      },
      sent: {
        cookieNames: sentCookieNames,
        sentCookie: Boolean(cookie),
        sentCartToken,
      },
      receivedCookieNames: setCookies
        .map(parseCookie)
        .filter(Boolean)
        .map(({ name }) => name),
    };
  }
}

function cartSnapshot(client, response) {
  const cart = response.payload;
  return {
    client: client.name,
    status: response.status,
    requestedUrl: response.requestedUrl,
    finalUrl: response.finalUrl,
    redirects: response.redirects,
    sentCookie: response.sent.sentCookie,
    sentCookieNames: response.sent.cookieNames,
    sentCartToken: response.sent.sentCartToken,
    receivedCookieNames: response.receivedCookieNames,
    token: maskSecret(client.tokenForComparison()),
    headers: response.headers,
    itemsCount:
      typeof cart?.items_count === "number"
        ? cart.items_count
        : Array.isArray(cart?.items)
          ? cart.items.length
          : null,
    totalItems: cart?.totals?.total_items ?? null,
    itemKeysHash: hashItemKeys(cart),
  };
}

function endpoint(kind) {
  if (mode === "direct") {
    if (kind === "get") return "";
    if (kind === "add") return "add-item";
    if (kind === "remove") return "remove-item";
    if (kind === "customer") return "update-customer";
  }
  if (kind === "get") return "";
  if (kind === "add" || kind === "remove") return "items";
  throw new Error(`Endpoint ${kind} ainda não existe no proxy Next.js.`);
}

function withDiagnosticQuery(pathname, clientName) {
  const url = new URL(pathname, baseUrl);
  if (!useUniqueQuery) return url.toString();
  url.searchParams.set(
    "persi_session_test",
    `${clientName.toLowerCase()}-${randomUUID()}`,
  );
  return url.toString();
}

const clientA = new IsolatedClient("A");
const clientB = new IsolatedClient("B");

try {
  const initialA = await clientA.request(
    withDiagnosticQuery(endpoint("get"), "A"),
  );
  const initialB = await clientB.request(
    withDiagnosticQuery(endpoint("get"), "B"),
  );
  const tokenA = clientA.tokenForComparison();
  const tokenB = clientB.tokenForComparison();
  const initialTokensDistinct = Boolean(tokenA && tokenB && tokenA !== tokenB);

  const report = {
    mode,
    uniqueQuery: useUniqueQuery,
    mutationsEnabled: allowMutations,
    initial: [
      cartSnapshot(clientA, initialA),
      cartSnapshot(clientB, initialB),
    ],
    initialTokensDistinct,
    mutation: { executed: false },
  };

  if (allowMutations) {
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new Error(
        "Defina CART_ISOLATION_PRODUCT_ID para executar mutações.",
      );
    }
    if (!initialTokensDistinct) {
      throw new Error(
        "Mutações bloqueadas: os tokens iniciais não são distintos.",
      );
    }
    const initialACount = report.initial[0].itemsCount;
    const initialBCount = report.initial[1].itemsCount;
    if (initialACount !== 0 || initialBCount !== 0) {
      throw new Error(
        "Mutações bloqueadas: as sessões de diagnóstico não começaram vazias.",
      );
    }

    const addBody =
      mode === "direct"
        ? { id: productId, quantity: 1 }
        : { productId, quantity: 1 };
    const addedA = await clientA.request(endpoint("add"), {
      method: "POST",
      body: addBody,
    });
    const afterA = await clientA.request(endpoint("get"));
    const afterB = await clientB.request(endpoint("get"));
    const isolated =
      afterA.payload?.items_count === 1 && afterB.payload?.items_count === 0;

    report.mutation = {
      executed: true,
      addStatus: addedA.status,
      clientA: cartSnapshot(clientA, afterA),
      clientB: cartSnapshot(clientB, afterB),
      cartsIsolated: isolated,
    };

    const addedItemKey = addedA.payload?.items?.find(
      (item) => item?.id === productId,
    )?.key;
    if (isolated && typeof addedItemKey === "string") {
      const removed = await clientA.request(endpoint("remove"), {
        method: mode === "direct" ? "POST" : "DELETE",
        body: { key: addedItemKey },
      });
      const finalA = await clientA.request(endpoint("get"));
      const finalB = await clientB.request(endpoint("get"));
      const bothSessionsEmpty =
        finalA.payload?.items_count === 0 && finalB.payload?.items_count === 0;
      report.mutation.cleanup = {
        attempted: true,
        removeStatus: removed.status,
        clientA: cartSnapshot(clientA, finalA),
        clientB: cartSnapshot(clientB, finalB),
        bothSessionsEmpty,
      };
      if (!bothSessionsEmpty) {
        throw new Error(
          "Limpeza não confirmada: as duas sessões devem terminar vazias.",
        );
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  clientA.close();
  clientB.close();
}
