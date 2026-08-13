const PUBLIC_ORIGIN = "https://persimateriais.com.br";
const BACKEND_ORIGIN = "https://loja.persimateriais.com.br";
const NO_STORE = "private, no-store, no-cache, must-revalidate, max-age=0";

export function buildOriginUrl(input) {
  const publicUrl = new URL(input);
  const originUrl = new URL(publicUrl.pathname + publicUrl.search, BACKEND_ORIGIN);

  if (publicUrl.searchParams.has("wc-ajax")) {
    // wc_get_endpoint_url() publica o AJAX na raiz. Encaminhar o POST para
    // /checkout/ permite que canonical/SEO intervenham antes do handler.
    originUrl.pathname = "/";
  } else if (publicUrl.pathname === "/checkout/transfer") {
    const token = publicUrl.searchParams.get("token");
    originUrl.pathname = "/checkout/";
    originUrl.search = "";
    if (token) originUrl.searchParams.set("persi_checkout_transfer", token);
  } else if (publicUrl.pathname === "/checkout/admin-ajax.php") {
    originUrl.pathname = "/wp-admin/admin-ajax.php";
  }

  return originUrl;
}

export function rewriteLocation(value) {
  if (!value) return value;
  const location = new URL(value, BACKEND_ORIGIN);
  if (location.origin !== BACKEND_ORIGIN) return value;
  if (location.pathname === "/carrinho/" || location.pathname === "/carrinho") {
    return `${PUBLIC_ORIGIN}/carrinho`;
  }
  if (!location.pathname.startsWith("/checkout")) return value;
  return new URL(location.pathname + location.search + location.hash, PUBLIC_ORIGIN).toString();
}

export function rewriteSetCookie(value) {
  return value
    .replace(/;\s*Domain=[^;]+/gi, "")
    .replace(/;\s*Path=[^;]+/gi, "; Path=/checkout/");
}

export function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((item) => item.trim());
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  return splitSetCookieHeader(headers.get("set-cookie"));
}

export function rewriteCheckoutHtml(html) {
  const replacements = [
    [`${BACKEND_ORIGIN}/?wc-ajax=`, `${PUBLIC_ORIGIN}/checkout/?wc-ajax=`],
    [`${BACKEND_ORIGIN}/wp-admin/admin-ajax.php`, `${PUBLIC_ORIGIN}/checkout/admin-ajax.php`],
    [`${BACKEND_ORIGIN}/checkout/`, `${PUBLIC_ORIGIN}/checkout/`],
    ["https:\\/\\/loja.persimateriais.com.br\\/?wc-ajax=", "https:\\/\\/persimateriais.com.br\\/checkout\\/?wc-ajax="],
    ["https:\\/\\/loja.persimateriais.com.br\\/wp-admin\\/admin-ajax.php", "https:\\/\\/persimateriais.com.br\\/checkout\\/admin-ajax.php"],
    ["https:\\/\\/loja.persimateriais.com.br\\/checkout\\/", "https:\\/\\/persimateriais.com.br\\/checkout\\/"],
    ['"/wp-admin/admin-ajax.php"', '"/checkout/admin-ajax.php"'],
    ["'/wp-admin/admin-ajax.php'", "'/checkout/admin-ajax.php'"],
    ["\\/wp-admin\\/admin-ajax.php", "\\/checkout\\/admin-ajax.php"],
  ];

  return replacements.reduce(
    (result, [from, to]) => result.split(from).join(to),
    html,
  );
}

function safeLog(requestUrl, originUrl, status, location) {
  const incoming = new URL(requestUrl);
  const origin = new URL(originUrl);
  incoming.search = "";
  origin.search = "";
  console.log("checkout-proxy", {
    incoming: incoming.toString(),
    origin: origin.toString(),
    status,
    location: location ? new URL(location, PUBLIC_ORIGIN).pathname : "",
  });
}

export async function handleRequest(request, fetchImplementation = fetch) {
  const publicUrl = new URL(request.url);
  if (!publicUrl.pathname.startsWith("/checkout/")) {
    return new Response("Not found", { status: 404 });
  }
  if (
    publicUrl.pathname === "/checkout/transfer" &&
    !/^[A-Za-z0-9_-]{43}$/.test(publicUrl.searchParams.get("token") ?? "")
  ) {
    return new Response("Invalid transfer", {
      status: 400,
      headers: { "Cache-Control": NO_STORE },
    });
  }

  const originUrl = buildOriginUrl(publicUrl);
  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  headers.set("X-Forwarded-Host", publicUrl.host);
  headers.set("X-Forwarded-Proto", "https");
  if (headers.has("Origin")) headers.set("Origin", BACKEND_ORIGIN);
  if (headers.has("Referer")) {
    headers.set("Referer", `${BACKEND_ORIGIN}${publicUrl.pathname}${publicUrl.search}`);
  }

  const requestBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
  const originResponse = await fetchImplementation(originUrl, {
    method: request.method,
    headers,
    body: requestBody,
    redirect: "manual",
  });
  const responseHeaders = new Headers(originResponse.headers);
  const setCookies = getSetCookies(originResponse.headers);
  responseHeaders.delete("set-cookie");
  for (const cookie of setCookies) responseHeaders.append("Set-Cookie", rewriteSetCookie(cookie));
  responseHeaders.set("Cache-Control", NO_STORE);
  responseHeaders.set("Pragma", "no-cache");
  responseHeaders.set("Expires", "0");
  responseHeaders.delete("Content-Length");

  const originLocation = originResponse.headers.get("location");
  const publicLocation = rewriteLocation(originLocation);
  if (publicLocation) responseHeaders.set("Location", publicLocation);

  const contentType = originResponse.headers.get("content-type") ?? "";
  let body = originResponse.body;
  if (request.method !== "HEAD" && contentType.includes("text/html")) {
    body = rewriteCheckoutHtml(await originResponse.text());
  }

  safeLog(request.url, originUrl, originResponse.status, publicLocation);
  return new Response(body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers: responseHeaders,
  });
}

const worker = { fetch: handleRequest };

export default worker;
