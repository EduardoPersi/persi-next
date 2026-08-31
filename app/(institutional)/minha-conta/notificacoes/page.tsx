import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { getServerAccountSession } from "@/services/account/serverSession";
export const metadata:Metadata={title:"Notificações | Minha conta",robots:{index:false,follow:false}};
export default async function Page(){const session=await getServerAccountSession();if(!session)redirect("/entrar");return <CustomerWorkspacePage title="Notificações" session={session}><div className="rounded-xl bg-slate-50 p-8 text-center"><Bell className="mx-auto h-12 w-12 text-primary" aria-hidden="true"/><h2 className="mt-4 text-lg font-bold text-primary-hover">Nenhuma notificação no momento</h2><p className="mt-2 text-muted">Avisos, novidades, promoções e reposições aparecerão aqui.</p><Link href="/minha-conta/lista-espera" className="mt-5 inline-flex font-semibold text-primary underline">Ver lista de espera</Link></div></CustomerWorkspacePage>}
