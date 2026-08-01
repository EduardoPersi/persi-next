import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import { CUSTOMER_LIST_TYPES, type CustomerListType } from "@/lib/customer-lists/types";
import { removeCustomerListItem } from "@/services/account/customerLists";

const headers = { "Cache-Control": "private, no-store" };

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ listType: string; productId: string }> },
) {
  const { listType, productId: rawProductId } = await params;
  const token = (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;
  const productId = Number(rawProductId);
  if (!CUSTOMER_LIST_TYPES.includes(listType as CustomerListType))
    return NextResponse.json({ message: "Tipo de lista inválido." }, { status: 404, headers });
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return NextResponse.json({ message: "Sessão necessária." }, { status: 401, headers });
  if (!Number.isInteger(productId) || productId <= 0)
    return NextResponse.json({ message: "Produto inválido." }, { status: 400, headers });
  try {
    return NextResponse.json(
      await removeCustomerListItem(token, listType as CustomerListType, productId),
      { headers },
    );
  } catch {
    return NextResponse.json({ message: "Não foi possível remover o item." }, { status: 502, headers });
  }
}
