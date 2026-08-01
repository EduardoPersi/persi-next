import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { parseOrderId } from "@/lib/account/orders";
import { AccountServiceError } from "@/services/account/client";
import { getAccountOrder } from "@/services/account/orders";
import { getServerAccountSession, getServerAccountToken } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Detalhes do pedido | Persi Materiais", robots: { index: false, follow: false } };

const Address = ({ value }: { value: { firstName: string; lastName: string; company: string; address1: string; address2: string; city: string; state: string; postcode: string; country: string; email?: string; phone?: string } }) => (
  <address className="mt-3 not-italic leading-7 text-slate-700">
    <p>{value.firstName} {value.lastName}</p>{value.company && <p>{value.company}</p>}
    <p>{value.address1}{value.address2 ? `, ${value.address2}` : ""}</p>
    <p>{value.city} - {value.state}, {value.postcode}</p>
    {value.email && <p>{value.email}</p>}{value.phone && <p>{value.phone}</p>}
  </address>
);

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [session, token] = await Promise.all([getServerAccountSession(), getServerAccountToken()]);
  if (!session || !token) redirect("/entrar");
  let order;
  try {
    order = await getAccountOrder(token, parseOrderId((await params).id));
  } catch (error) {
    if (error instanceof AccountServiceError && error.status === 401) redirect("/entrar");
    const missing = error instanceof AccountServiceError && error.status === 404;
    return <CustomerWorkspacePage title={missing ? "Pedido não encontrado" : "Detalhes do pedido"} session={session}><p role="alert">{missing ? "Pedido não encontrado." : "Não foi possível carregar seus pedidos agora."}</p></CustomerWorkspacePage>;
  }
  return (
    <CustomerWorkspacePage title={`Pedido #${order.number}`} session={session}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(order.dateCreated))}</p>
        <span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-[#0c2d72]">{order.statusLabel}</span>
      </div>
      <section className="mt-7"><h2 className="text-xl font-bold text-[#071f5c]">Itens</h2>
        <div className="mt-4 grid gap-4">{order.items.map((item) => <article key={item.id} className="flex gap-4 rounded-xl border p-4">
          <Image src={item.image.src} alt={item.image.alt} width={88} height={88} className="h-22 w-22 rounded-xl object-contain" />
          <div><h3 className="font-semibold">{item.name}</h3><p className="mt-1 text-sm">Quantidade: {item.quantity}</p><p className="mt-2 font-semibold">{item.total.formatted}</p></div>
        </article>)}</div>
      </section>
      <section className="mt-7 rounded-xl bg-slate-50 p-5"><h2 className="text-xl font-bold text-[#071f5c]">Resumo</h2>
        <dl className="mt-4 grid gap-2">{Object.entries({ Subtotal: order.totals.subtotal, Desconto: order.totals.discount, Frete: order.totals.shipping, Taxas: order.totals.fees, Impostos: order.totals.tax, Total: order.totals.total }).map(([label, money]) => <div key={label} className="flex justify-between"><dt>{label}</dt><dd className={label === "Total" ? "font-bold" : ""}>{money.formatted}</dd></div>)}</dl>
        <p className="mt-5"><strong>Pagamento:</strong> {order.payment.title || "Não informado"}</p>
      </section>
      <div className="mt-7 grid gap-5 md:grid-cols-2"><section className="rounded-xl border p-5"><h2 className="font-bold text-[#071f5c]">Endereço de entrega</h2><Address value={order.shipping.address} /><p className="mt-3 text-sm">{order.shipping.methodTitle}</p></section>
      <section className="rounded-xl border p-5"><h2 className="font-bold text-[#071f5c]">Endereço de cobrança</h2><Address value={order.billing} /></section></div>
      {order.customerNote && <section className="mt-7"><h2 className="font-bold text-[#071f5c]">Observação</h2><p className="mt-2 whitespace-pre-wrap">{order.customerNote}</p></section>}
    </CustomerWorkspacePage>
  );
}
