import { NextResponse } from "next/server";
import { COOKIE_RECUPERACAO } from "@/lib/painel/recuperarCookie";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Apaga o cookie de recuperação (`persi_recuperacao`, httpOnly) depois que a
// página do checkout o entregou ao navegador: o pré-preenchimento vale uma
// vez só. Só apaga; não lê nem devolve nada.
export async function DELETE() {
  const resposta = new NextResponse(null, { status: 204 });
  resposta.cookies.set(COOKIE_RECUPERACAO, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
  resposta.headers.set("Cache-Control", "no-store");
  return resposta;
}
