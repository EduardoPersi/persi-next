import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import { addFavorite, listFavorites } from "@/services/account/favorites";
const headers={"Cache-Control":"private, no-store"};
function token(value:string|undefined){return value&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:null;}
export async function GET(){const value=token((await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value);if(!value)return NextResponse.json({message:"Sessão necessária."},{status:401,headers});try{return NextResponse.json(await listFavorites(value),{headers});}catch{return NextResponse.json({message:"Não foi possível carregar os favoritos."},{status:502,headers});}}
export async function POST(request:NextRequest){const value=token((await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value);const body:unknown=await request.json().catch(()=>null);const id=typeof body==="object"&&body!==null?(body as {productId?:unknown}).productId:null;if(!value)return NextResponse.json({message:"Sessão necessária."},{status:401,headers});if(!Number.isInteger(id)||Number(id)<=0)return NextResponse.json({message:"Produto inválido."},{status:400,headers});try{return NextResponse.json(await addFavorite(value,Number(id)),{status:201,headers});}catch{return NextResponse.json({message:"Não foi possível salvar o favorito."},{status:502,headers});}}
