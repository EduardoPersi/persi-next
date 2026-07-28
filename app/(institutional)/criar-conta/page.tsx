import type { Metadata } from "next";
import { AccountRegisterForm } from "@/components/Account/AccountRegisterForm";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
export const metadata:Metadata={title:"Criar conta | Persi Materiais",robots:{index:false,follow:false}};
export default function RegisterPage(){return <InstitutionalPageLayout title="Criar conta" accountSession={{authenticated:false}}><div className="mx-auto max-w-md"><p className="mb-6 text-slate-600">Crie sua conta para acompanhar seus pedidos com segurança.</p><AccountRegisterForm/></div></InstitutionalPageLayout>;}
