import { NextResponse } from "next/server";
import { parseStockToken } from "@/lib/stock-notifications/validation";
import { submitStockToken } from "@/services/woocommerce/stockNotifications";
const headers={"Cache-Control":"private, no-store, no-cache, max-age=0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosn"};
export async function POST(request:Request){try{const token=parseStockToken(await request.json());const result=await submitStockToken("unsubscribe",token);return NextResponse.json({message:result.ok?"Seu aviso foi cancelado.":"Não foi possível concluir esta solicitação."},{status:result.ok?200:400,headers});}catch{return NextResponse.json({message:"Não foi possível concluir esta solicitação."},{status:400,headers});}}
