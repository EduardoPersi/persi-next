import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerProfileForm } from "@/components/Account/CustomerProfileForm";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { getServerAccountSession,getServerAccountToken } from "@/services/account/serverSession";
import { getCustomerWorkspaceProfile } from "@/services/account/workspace";
export const dynamic="force-dynamic";export const metadata:Metadata={title:"Perfil | Minha conta",robots:{index:false,follow:false}};
export default async function Page(){const[session,token]=await Promise.all([getServerAccountSession(),getServerAccountToken()]);if(!session||!token)redirect("/entrar");const profile=await getCustomerWorkspaceProfile(token).catch(()=>({firstName:session.customer.firstName,lastName:"",displayName:session.customer.displayName,email:session.customer.email,phone:"",birthDate:"",cpf:""}));return <CustomerWorkspacePage title="Dados pessoais" session={session}><CustomerProfileForm initialProfile={profile}/></CustomerWorkspacePage>}
