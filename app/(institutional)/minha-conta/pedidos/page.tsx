import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { getAccountOrders } from "@/services/account/orders";
import { getServerAccountSession, getServerAccountToken } from "@/services/account/serverSession";
import { AccountServiceError } from "@/services/account/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Meus pedidos | Persi Materiais", robots: { index: false, follow: false } };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [session, token] = await Promise.all([getServerAccountSession(), getServerAccountToken()]);
  if (!session || !token) redirect("/entrar");
  const rawPage = (await searchParams).page ?? "1";
  const page = /^[1-9][0-9]*$/.test(rawPage) ? Number(rawPage) : 1;
  let result;
  try {
    result = await getAccountOrders(token, { page, perPage: 10 });
  } catch (error) {
    if (error instanceof AccountServiceError && error.status === 401) redirect("/entrar");
    return <CustomerWorkspacePage title="Meus pedidos" session={session}><p role="alert">Não foi possível carregar seus pedidos agora.</p></CustomerWorkspacePage>;
  }

  return (
    <CustomerWorkspacePage title="Meus pedidos" session={session}>
      <div className="mb-6 flex flex-wrap gap-2" aria-label="Categorias de pedidos">
        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">Em andamento: {result.orders.filter((order) => ["pending", "processing", "on-hold"].includes(order.status)).length}</span>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">Entregues: {result.orders.filter((order) => order.status === "completed").length}</span>
        <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-800">Cancelados: {result.orders.filter((order) => ["cancelled", "failed", "refunded"].includes(order.status)).length}</span>
      </div>
      {result.orders.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-6 text-center">
          <p>Você ainda não fez nenhum pedido.</p>
          <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#ff6a00] px-5 font-semibold text-white">Continuar comprando</Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {result.orders.map((order) => (
              <article key={order.id} className="rounded-xl border border-slate-200 p-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="font-bold text-[#071f5c]">Pedido #{order.number}</h2>
                    <p className="mt-1 text-sm text-slate-600">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(order.dateCreated))}</p>
                  </div>
                  <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-[#0c2d72]">{order.statusLabel}</span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-slate-500">Total</dt><dd className="font-semibold">{order.total.formatted}</dd></div>
                  <div><dt className="text-slate-500">Itens</dt><dd>{order.itemCount}</dd></div>
                  <div><dt className="text-slate-500">Pagamento</dt><dd>{order.paymentMethodTitle || "Não informado"}</dd></div>
                </dl>
                <Link href={`/minha-conta/pedidos/${order.id}`} className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-[#0c2d72] px-4 font-semibold text-[#0c2d72]">Ver detalhes</Link>
              </article>
            ))}
          </div>
          <nav aria-label="Paginação dos pedidos" className="mt-7 flex justify-center gap-3">
            {result.pagination.page > 1 && <Link className="rounded-xl border px-4 py-2" href={`?page=${result.pagination.page - 1}`}>Anterior</Link>}
            <span className="px-3 py-2">Página {result.pagination.page} de {Math.max(1, result.pagination.totalPages)}</span>
            {result.pagination.page < result.pagination.totalPages && <Link className="rounded-xl border px-4 py-2" href={`?page=${result.pagination.page + 1}`}>Próxima</Link>}
          </nav>
        </>
      )}
    </CustomerWorkspacePage>
  );
}
