import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE } from "@/lib/account/sessionCookie";
import { normalizeFavoriteIds } from "@/lib/favorites/favorites-types";
import { syncFavorites } from "@/services/account/favorites";
export async function PUT(request:NextRequest){const token=(await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;const raw:unknown=await request.json().catch(()=>null);if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return NextResponse.json({message:"Sessão necessária."},{status:401});if(!Array.isArray(raw)||raw.length>500||normalizeFavoriteIds(raw).length!==raw.length)return NextResponse.json({message:"Lista inválida."},{status:400});try{return NextResponse.json(await syncFavorites(token,normalizeFavoriteIds(raw)),{headers:{"Cache-Control":"private, no-store"}});}catch{return NextResponse.json({message:"Não foi possível sincronizar os favoritos."},{status:502});}}
