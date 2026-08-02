import { NextRequest, NextResponse } from "next/server";
import {
  CUSTOMER_LIST_TYPES,
  type CustomerListType,
} from "@/lib/customer-lists/types";
import { getServerAccountToken } from "@/services/account/serverSession";
import {
  addCustomerListItem,
  listCustomerList,
} from "@/services/account/customerLists";

const headers = { "Cache-Control": "private, no-store" };
const isListType = (value: string): value is CustomerListType =>
  CUSTOMER_LIST_TYPES.some((listType) => listType === value);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ listType: string }> },
) {
  const { listType } = await params;
  const token = await getServerAccountToken();
  if (!isListType(listType))
    return NextResponse.json({ message: "Tipo de lista inválido." }, { status: 404, headers });
  if (!token)
    return NextResponse.json({ message: "Sessão necessária." }, { status: 401, headers });
  try {
    return NextResponse.json(await listCustomerList(token, listType), { headers });
  } catch {
    return NextResponse.json({ message: "Não foi possível carregar a lista." }, { status: 502, headers });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ listType: string }> },
) {
  const { listType } = await params;
  const token = await getServerAccountToken();
  const body: unknown = await request.json().catch(() => null);
  const productId =
    typeof body === "object" && body !== null
      ? (body as { productId?: unknown }).productId
      : null;
  if (!isListType(listType))
    return NextResponse.json({ message: "Tipo de lista inválido." }, { status: 404, headers });
  if (!token)
    return NextResponse.json({ message: "Sessão necessária." }, { status: 401, headers });
  if (!Number.isInteger(productId) || Number(productId) <= 0)
    return NextResponse.json({ message: "Produto inválido." }, { status: 400, headers });
  try {
    return NextResponse.json(
      await addCustomerListItem(token, listType, Number(productId)),
      { status: 201, headers },
    );
  } catch {
    return NextResponse.json({ message: "Não foi possível salvar o item." }, { status: 502, headers });
  }
}
