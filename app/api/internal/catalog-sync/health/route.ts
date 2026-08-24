import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { catalogSyncHealth } from "@/services/catalog/inbox";
function authorized(request:Request){const expected=process.env.CATALOG_SYNC_HEALTH_SECRET??"",actual=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";const a=Buffer.from(actual),b=Buffer.from(expected);return Boolean(expected)&&a.length===b.length&&timingSafeEqual(a,b);}
export async function GET(request:Request){if(!authorized(request))return NextResponse.json({message:"Não autorizado."},{status:401});const health=await catalogSyncHealth();return NextResponse.json({ready:Boolean(health?.database)&&health.pending===0&&health.deadLetters===0,checks:health},{headers:{"Cache-Control":"private, no-store"}});}
