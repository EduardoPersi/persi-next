import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerAddresses } from "@/components/Account/CustomerAddresses";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { getServerAccountSession,getServerAccountToken } from "@/services/account/serverSession";
import { getCustomerWorkspaceAddresses } from "@/services/account/workspace";
export const dynamic="force-dynamic"; export const metadata:Metadata={title:"Endereços | Minha conta",robots:{index:false,follow:false}};
export default async function Page(){const[session,token]=await Promise.all([getServerAccountSession(),getServerAccountToken()]);if(!session||!token)redirect("/entrar");const empty=(type:"billing"|"shipping",label:string)=>({id:type,type,label,firstName:"",lastName:"",company:"",address1:"",neighborhood:"",address2:"",city:"",state:"",postcode:"",country:"BR",phone:"",isPrimary:type==="shipping"});const addresses=await getCustomerWorkspaceAddresses(token).catch(()=>[empty("billing","Cobrança"),empty("shipping","Entrega")]);return <CustomerWorkspacePage title="Endereços" session={session}><p className="mb-6 text-slate-600">Gerencie o endereço usado para cobrança e entrega no WooCommerce.</p><CustomerAddresses initialAddresses={addresses}/></CustomerWorkspacePage>}
