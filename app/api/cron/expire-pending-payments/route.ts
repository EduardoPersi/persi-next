import { NextResponse } from "next/server";
import { getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import { getPixChargeStatus } from "@/services/payments/inter/pix";
import { getCardChargeStatus } from "@/services/payments/pagbank/charge";
import {
  categorizeBoletoStatus,
  categorizeCardStatus,
  categorizePixStatus,
  reconcilePaymentReference,
} from "@/services/payments/reconcile";
import {
  createOverlapGuard,
  isAuthorizedCronRequest,
  reconcilePendingOrders,
  type ReconciliationCategory,
} from "@/services/payments/cronReconciliation";
import {
  findPendingOrdersWithPaymentReference,
  type WooCommerceOrder,
} from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const PAYMENT_REFERENCE_META = "_persi_payment_reference";

// Orçamento de tempo por execução, deixando margem segura abaixo do timeout
// comum de serviços de cron externos (cron-job.org, Hostinger, ~30s). Se a
// varredura ainda tiver pedidos por checar quando o orçamento acabar, ela
// para e devolve `truncated: true` — o restante fica para a próxima
// chamada (15-30 min depois). Ver observação de risco no fim do arquivo.
const TIME_BUDGET_MS = 20_000;
const CONCURRENCY = 5;

async function reconcileOrder(order: WooCommerceOrder): Promise<ReconciliationCategory> {
  const reference = order.metaData[PAYMENT_REFERENCE_META];

  if (order.paymentMethod === "inter_pix") {
    const charge = await getPixChargeStatus(reference);
    const category = categorizePixStatus(charge);
    await reconcilePaymentReference("inter", reference, category);
    return category;
  }

  if (order.paymentMethod === "inter_boleto") {
    const charge = await getBoletoChargeStatus(reference);
    const category = categorizeBoletoStatus(charge.status);
    await reconcilePaymentReference("inter", reference, category);
    return category;
  }

  const charge = await getCardChargeStatus(reference);
  const category = categorizeCardStatus(charge.status);
  await reconcilePaymentReference("pagbank", reference, category);
  return category;
}

// Não existe um agendador (cron) rodando dentro deste app Next.js — este
// endpoint precisa ser chamado periodicamente por uma tarefa agendada
// externa (cron-job.org, cron da Hostinger, etc.) autenticada por
// CRON_SECRET via header `Authorization: Bearer <CRON_SECRET>`. Ele varre
// pedidos "pending" com cobrança já criada no provedor e reconcilia cada
// um: cobranças Pix/boleto vencidas sem pagamento são marcadas como falhas
// (via a mesma lógica idempotente usada pelo polling e pelos webhooks —
// nunca confia em nenhum status pré-computado, sempre reconsulta o
// provedor ao vivo).
//
// RISCO CONHECIDO: se o volume de pedidos pendentes acumulados crescer
// além do que cabe no orçamento de tempo (`TIME_BUDGET_MS`) em execuções
// sucessivas, o atraso da reconciliação aumenta indefinidamente. Monitore
// `truncated`/`remaining` na resposta e nos logs; se `truncated: true`
// aparecer com frequência, isso é sinal de que o volume já passou do que
// uma varredura sequencial dá conta — nesse ponto vale paralelizar mais,
// aumentar a frequência do cron, ou mover para uma fila de verdade.

// Guarda em memória de processo único (a Hostinger roda um único processo
// Node persistente, não um cluster) — impede que duas execuções
// sobrepostas do cron rodem ao mesmo tempo e disputem os mesmos pedidos.
// Não protege contra múltiplas instâncias/processos do app rodando em
// paralelo; se isso mudar no futuro, substituir por um lock externo (ex.:
// registro em banco/Redis).
const overlapGuard = createOverlapGuard();

async function handleCronRequest(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  if (!overlapGuard.tryAcquire()) {
    console.warn(
      "[cron-expire-pending-payments] execução ignorada — já existe uma em andamento",
    );
    return NextResponse.json(
      { message: "Já existe uma execução em andamento." },
      { status: 409 },
    );
  }

  try {
    const orders = await findPendingOrdersWithPaymentReference();
    const summary = await reconcilePendingOrders(orders, {
      timeBudgetMs: TIME_BUDGET_MS,
      concurrency: CONCURRENCY,
      reconcileOrder,
      getOrderId: (order) => order.id,
      onOrderError: (order, error) => {
        console.error("[cron-expire-pending-payments] falha ao reconciliar pedido", {
          orderId: order.id,
          code: error instanceof Error ? error.name : "UNKNOWN",
        });
      },
    });

    console.log("[cron-expire-pending-payments] resumo da execução", summary);
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("[cron-expire-pending-payments] falha ao listar pedidos pendentes", {
      code: error instanceof Error ? error.name : "UNKNOWN",
    });
    return NextResponse.json({ message: "Falha ao executar a varredura." }, { status: 502 });
  } finally {
    overlapGuard.release();
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleCronRequest(request);
}

// GET aceito só para permitir teste manual rápido (ex.: colar a URL no
// navegador durante o desenvolvimento); o cron externo deve usar POST.
export async function GET(request: Request): Promise<Response> {
  return handleCronRequest(request);
}
