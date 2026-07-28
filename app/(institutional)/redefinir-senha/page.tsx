import type { Metadata } from "next";
import { AccountResetPasswordForm } from "@/components/Account/AccountResetPasswordForm";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
export const metadata:Metadata={title:"Redefinir senha | Persi Materiais",robots:{index:false,follow:false}};
export default async function ResetPage({searchParams}:{searchParams:Promise<{key?:string;login?:string}>}){const {key="",login=""}=await searchParams;return <InstitutionalPageLayout title="Redefinir senha" accountSession={{authenticated:false}}><div className="mx-auto max-w-md">{key&&login?<AccountResetPasswordForm login={login} keyValue={key}/>:<p role="alert">Link de recuperação inválido.</p>}</div></InstitutionalPageLayout>;}
