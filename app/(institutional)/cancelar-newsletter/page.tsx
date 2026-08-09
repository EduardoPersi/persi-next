import type { Metadata } from "next";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import { NewsletterTokenAction } from "@/components/Account/NewsletterTokenAction";
export const metadata:Metadata={title:"Cancelar newsletter | Persi Materiais",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Page({searchParams}:{searchParams:Promise<{token?:string}>}){const token=(await searchParams).token??"";return <InstitutionalPageLayout title="Cancelar inscrição na newsletter">{token?<NewsletterTokenAction token={token} action="unsubscribe"/>:<p>Não foi possível concluir esta solicitação.</p>}</InstitutionalPageLayout>;}
