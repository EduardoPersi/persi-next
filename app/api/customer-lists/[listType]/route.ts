import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import {
  CUSTOMER_LIST_TYPES,
  type CustomerListType,
} from "@/lib/customer-lists/types";
import {
  addCustomerListItem,
  listCustomerList,
} from "@/services/account/customerLists";

const headers = { "Cache-Control": "private, no-store" };
const isListType = (value: string): value is CustomerListType =>
  CUSTOMER_LIST_TYPES.some((listType) => listType === value);
const validToken = (value: string | undefined) =>
  value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ listType: string }> },
) {
  const { listType } = await params;
  const token = validToken((await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value);
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
  const token = validToken((await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value);
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
