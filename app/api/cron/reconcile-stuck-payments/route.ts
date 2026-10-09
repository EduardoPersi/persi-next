import { NextResponse } from "next/server";
import { getCheckoutAttempt } from "@/lib/commerce/checkoutAttempt";
import { getPixChargeStatus } from "@/services/payments/inter/pix";
import { InterPaymentError } from "@/services/payments/inter/errors";
import { findCardChargeByReference as findMercadoPagoCharge } from "@/services/payments/mercadopago/charge";
import { findCardChargeByReference as findPagBankCharge } from "@/services/payments/pagbank/charge";
import {
  categorizeCardStatus,
  categorizeMercadoPagoCardStatus,
  categorizePixStatus,
  reconcilePaymentReference,
} from "@/services/payments/reconcile";
import {
  createOverlapGuard,
  isAuthorizedCronRequest,
} from "@/services/payments/cronReconciliation";
import {
  isStuckCandidate,
  reconcileStuckOrder,
  STUCK_MAX_AGE_MS,
  type StuckDeps,
  type StuckResult,
} from "@/services/payments/stuckPayments";
import {
  attachPaymentReference,
  findPendingOrdersWithoutPaymentReference,
  markOrderAsFailed,
} from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// TENTATIVAS DE PAGAMENTO TRAVADAS (PAYMENT_CREATING sem a cobrança guardada).
// Chamada de 5 em 5 minutos por uma tarefa agendada externa (a mesma que já chama
// /api/cron/expire-pending-payments), com `Authorization: Bearer <CRON_SECRET>`.
// A regra está em services/payments/stuckPayments.ts. SÓ LEITURA no gateway: esta
// rota não cria, não estorna e não repete cobrança.
//
// `?dryRun=1` faz a passada inteira (lista, consulta o gateway, decide) sem gravar
// nada, para conferir o que ela faria.
//
// O log traz só número do pedido, gateway e resultado: nada de dado pessoal.

// Orçamento de tempo, como na outra rotina de cron: o que sobrar fica para a próxima.
const TIME_BUDGET_MS = 20_000;
const MAX_ORDERS_PER_RUN = 50;

// Trava simples em memória de processo único (a Hostinger roda um só): a rotina não
// roda em paralelo com ela mesma.
const overlapGuard = createOverlapGuard();

function isNotFound(error: unknown): boolean {
  return error instanceof InterPaymentError && error.status === 404;
}

async function handleCronRequest(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  if (!overlapGuard.tryAcquire()) {
    console.warn("[cron-reconcile-stuck-payments] execução ignorada: já existe uma em andamento");
    return NextResponse.json({ message: "Já existe uma execução em andamento." }, { status: 409 });
  }

  try {
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const startedAt = Date.now();
    const after = new Date(startedAt - STUCK_MAX_AGE_MS - 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "");

    const orders = (await findPendingOrdersWithoutPaymentReference(after))
      .filter((order) => isStuckCandidate(order, startedAt))
      .slice(0, MAX_ORDERS_PER_RUN);

    const summary: Record<StuckResult, number> = {
      paid: 0,
      declined: 0,
      not_found_failed: 0,
      pending: 0,
      skipped: 0,
      error: 0,
    };

    const deps: StuckDeps = {
      getAttemptState: async (key) => {
        try {
          return (await getCheckoutAttempt(key)).state;
        } catch (error) {
          // O plugin responde 404 quando a chave nunca existiu.
          if (error instanceof Error && error.message.endsWith("(404)")) return null;
          throw error;
        }
      },
      readers: {
        mercadopago: async (referenceId) => {
          const charge = await findMercadoPagoCharge(referenceId);
          return charge
            ? { externalId: charge.chargeId, category: categorizeMercadoPagoCardStatus(charge.status) }
            : null;
        },
        pagbank: async (referenceId) => {
          const charge = await findPagBankCharge(referenceId);
          return charge
            ? { externalId: charge.chargeId, category: categorizeCardStatus(charge.status) }
            : null;
        },
        pix: async (txid) => {
          try {
            const charge = await getPixChargeStatus(txid);
            return { externalId: charge.txid, category: categorizePixStatus(charge) };
          } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
          }
        },
      },
      // Mesmo caminho do webhook: guarda a referência no pedido e reconcilia.
      markPaid: async (order, provider, externalId) => {
        if (dryRun) return;
        await attachPaymentReference(order.id, { provider, externalId });
        await reconcilePaymentReference(provider, externalId, "paid");
      },
      markDeclined: async (order, provider, externalId) => {
        if (dryRun) return;
        await attachPaymentReference(order.id, { provider, externalId });
        await reconcilePaymentReference(provider, externalId, "failed");
      },
      attachReference: async (order, provider, externalId) => {
        if (dryRun) return;
        await attachPaymentReference(order.id, { provider, externalId });
      },
      markNotFound: async (order) => {
        if (dryRun) return;
        await markOrderAsFailed(order, "failed");
      },
      now: Date.now,
      log: (entry) => {
        console.log("[cron-reconcile-stuck-payments]", { ...entry, ...(dryRun ? { dryRun: true } : {}) });
      },
    };

    let processed = 0;
    for (const order of orders) {
      if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
      summary[await reconcileStuckOrder(order, deps)] += 1;
      processed += 1;
    }

    const result = {
      dryRun,
      candidates: orders.length,
      processed,
      truncated: processed < orders.length,
      ...summary,
      durationMs: Date.now() - startedAt,
    };
    console.log("[cron-reconcile-stuck-payments] resumo da execução", result);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[cron-reconcile-stuck-payments] falha ao listar pedidos", {
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

// GET aceito só para teste manual (ex.: com ?dryRun=1); o cron externo deve usar POST.
export async function GET(request: Request): Promise<Response> {
  return handleCronRequest(request);
}
