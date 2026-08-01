import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import { CUSTOMER_LIST_TYPES, normalizeProductIds, type CustomerListType } from "@/lib/customer-lists/types";
import { syncCustomerList } from "@/services/account/customerLists";

const headers = { "Cache-Control": "private, no-store" };

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ listType: string }> },
) {
  const { listType } = await params;
  const token = (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;
  const raw: unknown = await request.json().catch(() => null);
  if (!CUSTOMER_LIST_TYPES.includes(listType as CustomerListType))
    return NextResponse.json({ message: "Tipo de lista inválido." }, { status: 404, headers });
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return NextResponse.json({ message: "Sessão necessária." }, { status: 401, headers });
  if (!Array.isArray(raw) || raw.length > 500 || normalizeProductIds(raw).length !== raw.length)
    return NextResponse.json({ message: "Lista inválida." }, { status: 400, headers });
  try {
    return NextResponse.json(
      await syncCustomerList(token, listType as CustomerListType, normalizeProductIds(raw)),
      { headers },
    );
  } catch {
    return NextResponse.json({ message: "Não foi possível sincronizar a lista." }, { status: 502, headers });
  }
}
