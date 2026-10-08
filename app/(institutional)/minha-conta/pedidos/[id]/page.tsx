import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { parseOrderId } from "@/lib/account/orders";
import { AccountServiceError } from "@/services/account/client";
import { urlDoRastreio } from "@/lib/rastreio/melhorEnvio";
import { getAccountOrder } from "@/services/account/orders";
import { getOrderById } from "@/services/woocommerce/orders";
import { getServerAccountSession, getServerAccountToken } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Detalhes do pedido | Persi Materiais", robots: { index: false, follow: false } };

const Address = ({ value }: { value: { firstName: string; lastName: string; company: string; address1: string; address2: string; city: string; state: string; postcode: string; country: string; email?: string; phone?: string } }) => (
  <address className="mt-3 not-italic leading-7 text-foreground">
    <p>{value.firstName} {value.lastName}</p>{value.company && <p>{value.company}</p>}
    <p>{value.address1}{value.address2 ? `, ${value.address2}` : ""}</p>
    <p>{value.city} - {value.state}, {value.postcode}</p>
    {value.email && <p>{value.email}</p>}{value.phone && <p>{value.phone}</p>}
  </address>
);

// O rastreio do Melhor Envio mora no pedido do WooCommerce (o plugin do
// WordPress o grava) e não no formato do plugin de conta, que é validado
// campo a campo. Só é chamado DEPOIS de `getAccountOrder` ter confirmado que o
// pedido é do cliente, e qualquer falha só esconde a seção — a página não cai.
async function buscarRastreios(orderId: number): Promise<string[]> {
  try {
    return (await getOrderById(orderId)).rastreios ?? [];
  } catch {
    return [];
  }
}

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
  const rastreios = await buscarRastreios(order.id);
  return (
    <CustomerWorkspacePage title={`Pedido #${order.number}`} session={session}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(order.dateCreated))}</p>
        <span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-primary">{order.statusLabel}</span>
      </div>
      {rastreios.length > 0 && <section className="mt-7 rounded-xl border border-blue-100 bg-blue-50 p-5" aria-labelledby="rastreio-titulo">
        <h2 id="rastreio-titulo" className="text-xl font-bold text-primary-hover">Acompanhe seu envio</h2>
        <ul className="mt-3 grid gap-2">{rastreios.map((codigo) => <li key={codigo} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Código de rastreio: <strong className="font-mono">{codigo}</strong></span>
          <a href={urlDoRastreio(codigo)} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-2">Rastrear a encomenda</a>
        </li>)}</ul>
      </section>}
      <section className="mt-7"><h2 className="text-xl font-bold text-primary-hover">Itens</h2>
        <div className="mt-4 grid gap-4">{order.items.map((item) => <article key={item.id} className="flex gap-4 rounded-xl border p-4">
          <Image src={item.image.src} alt={item.image.alt} width={88} height={88} className="h-22 w-22 rounded-xl object-contain" />
          <div><h3 className="font-semibold">{item.name}</h3><p className="mt-1 text-sm">Quantidade: {item.quantity}</p><p className="mt-2 font-semibold">{item.total.formatted}</p></div>
        </article>)}</div>
      </section>
      <section className="mt-7 rounded-xl bg-slate-50 p-5"><h2 className="text-xl font-bold text-primary-hover">Resumo</h2>
        <dl className="mt-4 grid gap-2">{Object.entries({ Subtotal: order.totals.subtotal, Desconto: order.totals.discount, Frete: order.totals.shipping, Taxas: order.totals.fees, Impostos: order.totals.tax, Total: order.totals.total }).map(([label, money]) => <div key={label} className="flex justify-between"><dt>{label}</dt><dd className={label === "Total" ? "font-bold" : ""}>{money.formatted}</dd></div>)}</dl>
        <p className="mt-5"><strong>Pagamento:</strong> {order.payment.title || "Não informado"}</p>
      </section>
      <div className="mt-7 grid gap-5 md:grid-cols-2"><section className="rounded-xl border p-5"><h2 className="font-bold text-primary-hover">Endereço de entrega</h2><Address value={order.shipping.address} /><p className="mt-3 text-sm">{order.shipping.methodTitle}</p></section>
      <section className="rounded-xl border p-5"><h2 className="font-bold text-primary-hover">Endereço de cobrança</h2><Address value={order.billing} /></section></div>
      {order.customerNote && <section className="mt-7"><h2 className="font-bold text-primary-hover">Observação</h2><p className="mt-2 whitespace-pre-wrap">{order.customerNote}</p></section>}
    </CustomerWorkspacePage>
  );
}
