import type { Metadata } from "next";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import { StockNotificationTokenAction } from "@/components/Product/StockNotificationTokenAction";
export const metadata:Metadata={title:"Cancelar aviso de estoque | Persi Materiais",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Page({searchParams}:{searchParams:Promise<{token?:string}>}){const token=(await searchParams).token??"";return <InstitutionalPageLayout title="Cancelar aviso de estoque">{token?<StockNotificationTokenAction token={token} action="unsubscribe"/>:<p>Não foi possível concluir esta solicitação.</p>}</InstitutionalPageLayout>;}
