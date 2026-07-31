import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import { removeFavorite } from "@/services/account/favorites";
export async function DELETE(_:Request,{params}:{params:Promise<{productId:string}>}){const token=(await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;const id=Number((await params).productId);if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return NextResponse.json({message:"Sessão necessária."},{status:401});if(!Number.isInteger(id)||id<=0)return NextResponse.json({message:"Produto inválido."},{status:400});try{return NextResponse.json(await removeFavorite(token,id),{headers:{"Cache-Control":"private, no-store"}});}catch{return NextResponse.json({message:"Não foi possível remover o favorito."},{status:502});}}
