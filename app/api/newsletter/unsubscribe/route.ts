import { NextResponse } from "next/server";
import { parseNewsletterToken } from "@/lib/newsletter/validation";
import { submitNewsletterToken } from "@/services/woocommerce/newsletter";
const headers={"Cache-Control":"private, no-store, no-cache, max-age=0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){try{const token=parseNewsletterToken(await request.json());const result=await submitNewsletterToken("unsubscribe",token);return NextResponse.json({message:result.ok?"Sua inscrição foi cancelada.":"Não foi possível concluir esta solicitação."},{status:result.ok?200:400,headers});}catch{return NextResponse.json({message:"Não foi possível concluir esta solicitação."},{status:400,headers});}}
