import { NextRequest, NextResponse } from "next/server";
import { CUSTOMER_LIST_TYPES, normalizeProductIds, type CustomerListType } from "@/lib/customer-lists/types";
import { getServerAccountToken } from "@/services/account/serverSession";
import { syncCustomerList } from "@/services/account/customerLists";

const headers = { "Cache-Control": "private, no-store, no-cache, must-revalidate" };

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ listType: string }> },
) {
  const { listType } = await params;
  const token = await getServerAccountToken();
  const raw: unknown = await request.json().catch(() => null);
  if (!CUSTOMER_LIST_TYPES.includes(listType as CustomerListType))
    return NextResponse.json({ message: "Tipo de lista inválido." }, { status: 404, headers });
  if (!token)
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
