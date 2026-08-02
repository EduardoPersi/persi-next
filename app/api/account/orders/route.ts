import { NextResponse } from "next/server";
import { parseOrdersQuery, AccountOrderValidationError } from "@/lib/account/orders";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { AccountServiceError } from "@/services/account/client";
import { getServerAccountToken } from "@/services/account/serverSession";
import { getAccountOrders } from "@/services/account/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: getPrivateAccountHeaders() });

export async function GET(request: Request) {
  const token = await getServerAccountToken();
  if (!token) return json({ message: "Não autorizado." }, 401);
  try {
    const query = parseOrdersQuery(new URL(request.url).searchParams);
    return json(await getAccountOrders(token, query));
  } catch (error) {
    if (error instanceof AccountOrderValidationError) return json({ message: "Parâmetros inválidos." }, 400);
    const status = error instanceof AccountServiceError && [401, 503].includes(error.status) ? error.status : 502;
    return json({ message: status === 401 ? "Não autorizado." : "Não foi possível carregar seus pedidos agora." }, status);
  }
}
