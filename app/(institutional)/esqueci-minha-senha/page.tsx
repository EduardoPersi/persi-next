import type { Metadata } from "next";
import { AccountForgotPasswordForm } from "@/components/Account/AccountForgotPasswordForm";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
export const metadata:Metadata={title:"Recuperar senha | Persi Materiais",robots:{index:false,follow:false}};
export default function ForgotPage(){return <InstitutionalPageLayout title="Esqueci minha senha" accountSession={{authenticated:false}}><div className="mx-auto max-w-md"><p className="mb-6 text-muted">Informe seu e-mail para receber as instruções oficiais do WordPress.</p><AccountForgotPasswordForm/></div></InstitutionalPageLayout>;}
