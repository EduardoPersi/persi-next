import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { StockNotificationList } from "@/components/Account/StockNotificationList";
import { getServerAccountSession,getServerAccountToken } from "@/services/account/serverSession";
import { getStockNotificationSubscriptions } from "@/services/account/workspace";
export const dynamic="force-dynamic";export const metadata:Metadata={title:"Lista de espera | Minha conta",robots:{index:false,follow:false}};
export default async function Page(){const[session,token]=await Promise.all([getServerAccountSession(),getServerAccountToken()]);if(!session||!token)redirect("/entrar");const items=await getStockNotificationSubscriptions(token).catch(()=>[]);return <CustomerWorkspacePage title="Lista de espera" session={session}><StockNotificationList initialItems={items}/></CustomerWorkspacePage>}
