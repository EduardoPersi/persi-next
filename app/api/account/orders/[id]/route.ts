import { NextResponse } from "next/server";
import { parseOrderId, AccountOrderValidationError } from "@/lib/account/orders";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { AccountServiceError } from "@/services/account/client";
import { getServerAccountToken } from "@/services/account/serverSession";
import { getAccountOrder } from "@/services/account/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: getPrivateAccountHeaders() });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const token = await getServerAccountToken();
  if (!token) return json({ message: "Não autorizado." }, 401);
  try {
    const id = parseOrderId((await context.params).id);
    return json({ order: await getAccountOrder(token, id) });
  } catch (error) {
    if (error instanceof AccountOrderValidationError) return json({ message: "Pedido não encontrado." }, 404);
    const status = error instanceof AccountServiceError && [401, 404, 503].includes(error.status) ? error.status : 502;
    return json({ message: status === 404 ? "Pedido não encontrado." : status === 401 ? "Não autorizado." : "Não foi possível carregar seus pedidos agora." }, status);
  }
}
