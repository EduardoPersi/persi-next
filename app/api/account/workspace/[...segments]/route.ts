import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import { validateMutationSource } from "@/lib/account/validation";
import { AccountServiceError, getAccountClientConfig } from "@/services/account/client";
import { requestCustomerWorkspace } from "@/services/account/workspace";

const responseHeaders = { "Cache-Control": "private, no-store" };
type Method = "GET" | "PUT" | "DELETE";

function resolveRoute(segments: string[]) {
  const path = `/${segments.join("/")}`;
  return /^\/(profile|addresses|connected-accounts|stock-notifications)$/.test(path) ||
    /^\/addresses\/(billing|shipping)$/.test(path) ||
    /^\/addresses\/(billing|shipping)\/primary$/.test(path) ||
    /^\/stock-notifications\/[1-9][0-9]*$/.test(path)
    ? path
    : null;
}

async function handle(request: NextRequest, segments: string[], method: Method) {
  const token = (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return NextResponse.json({ message: "Sessão necessária." }, { status: 401, headers: responseHeaders });
  const route = resolveRoute(segments);
  if (!route) return NextResponse.json({ message: "Recurso não encontrado." }, { status: 404, headers: responseHeaders });
  if (method !== "GET" && !validateMutationSource(request.headers, getAccountClientConfig().origin))
    return NextResponse.json({ message: "Origem inválida." }, { status: 403, headers: responseHeaders });
  const rawBody = method === "PUT" ? await request.text() : "";
  if (Buffer.byteLength(rawBody, "utf8") > 8192)
    return NextResponse.json({ message: "Dados inválidos." }, { status: 413, headers: responseHeaders });
  try {
    const body = await requestCustomerWorkspace(token, method, route as Parameters<typeof requestCustomerWorkspace>[2], rawBody);
    return NextResponse.json(body, { headers: responseHeaders });
  } catch (error) {
    const status = error instanceof AccountServiceError ? error.status : 502;
    return NextResponse.json({ message: error instanceof Error ? error.message : "Serviço indisponível." }, { status, headers: responseHeaders });
  }
}

type Context = { params: Promise<{ segments: string[] }> };
export async function GET(request: NextRequest, context: Context) { return handle(request, (await context.params).segments, "GET"); }
export async function PUT(request: NextRequest, context: Context) { return handle(request, (await context.params).segments, "PUT"); }
export async function DELETE(request: NextRequest, context: Context) { return handle(request, (await context.params).segments, "DELETE"); }
