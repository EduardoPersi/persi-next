import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { getServerAccountSession } from "@/services/account/serverSession";
export const metadata:Metadata={title:"Produtos vistos | Minha conta",robots:{index:false,follow:false}};
export default async function Page(){const session=await getServerAccountSession();if(!session)redirect("/entrar");return <CustomerWorkspacePage title="Produtos vistos" session={session}><p className="text-muted">Os últimos produtos visualizados neste dispositivo.</p><RecentlyViewedProducts title="Visualizados recentemente" sectionId="workspace-viewed-products" showEmptyState/></CustomerWorkspacePage>}
