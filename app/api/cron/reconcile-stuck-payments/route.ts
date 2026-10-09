import { NextResponse } from "next/server";
import { getCheckoutAttempt } from "@/lib/commerce/checkoutAttempt";
import { getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import { getPixChargeStatus } from "@/services/payments/inter/pix";
import { InterPaymentError } from "@/services/payments/inter/errors";
import {
  findCardChargeByReference as findMercadoPagoCharge,
  getCardChargeStatus as getMercadoPagoCharge,
} from "@/services/payments/mercadopago/charge";
import {
  findCardChargeByReference as findPagBankCharge,
  getCardChargeStatus as getPagBankCharge,
} from "@/services/payments/pagbank/charge";
import {
  evaluateBoletoCharge,
  evaluateCardCharge,
  evaluatePixCharge,
} from "@/services/payments/chargeEvaluation";
import { reconcilePaymentReference } from "@/services/payments/reconcile";
import {
  createOverlapGuard,
  isAuthorizedCronRequest,
} from "@/services/payments/cronReconciliation";
import {
  isPendingCandidate,
  isStuckCandidate,
  PENDING_MAX_AGE_MS,
  STUCK_MAX_AGE_MS,
  reconcilePendingOrder,
  reconcileStuckOrder,
  type FoundCharge,
  type StuckDeps,
  type StuckResult,
} from "@/services/payments/stuckPayments";
import {
  attachPaymentReference,
  findPendingOrdersWithPaymentReferenceSince,
  findPendingOrdersWithoutPaymentReference,
  markOrderAsFailed,
  type WooCommerceOrder,
} from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// REDE DE SEGURANÇA DOS PAGAMENTOS: tentativas travadas (faixa A) e pedidos
// pendentes com cobrança de até 5 dias (faixa B). Chamada de 10 em 10 minutos por
// uma tarefa agendada externa (a mesma que já chama /api/cron/expire-pending-payments),
// com `Authorization: Bearer <CRON_SECRET>`. A regra está em
// services/payments/stuckPayments.ts. SÓ LEITURA no gateway: esta rota não cria,
// não estorna e não repete cobrança, e não cancela Pix/boleto.
//
// `?dryRun=1` faz a passada inteira (lista, consulta o gateway, decide) sem gravar
// nada, para conferir o que ela faria. `?all=1` ignora a cadência por hora dos
// pedidos de 1 a 5 dias (útil no teste).
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

async function readPix(txid: string, order: WooCommerceOrder): Promise<FoundCharge | null> {
  try {
    const charge = await getPixChargeStatus(txid);
    return { externalId: charge.txid, evaluation: evaluatePixCharge(charge, order, Date.now()) };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readByReference(order: WooCommerceOrder, reference: string): Promise<FoundCharge | null> {
  switch (order.paymentMethod) {
    case "mercadopago_card":
      return { externalId: reference, evaluation: evaluateCardCharge("mercadopago", await getMercadoPagoCharge(reference), order) };
    case "inter_pix":
      return readPix(reference, order);
    case "inter_boleto":
      return { externalId: reference, evaluation: evaluateBoletoCharge(await getBoletoChargeStatus(reference), order) };
    default:
      return { externalId: reference, evaluation: evaluateCardCharge("pagbank", await getPagBankCharge(reference), order) };
  }
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
    const searchParams = new URL(request.url).searchParams;
    const dryRun = searchParams.get("dryRun") === "1";
    const all = searchParams.get("all") === "1";
    const startedAt = Date.now();
    const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "");

    // Faixa A (travadas sem cobrança) e faixa B (pendentes com cobrança, até 5 dias).
    const [withoutReference, withReference] = await Promise.all([
      findPendingOrdersWithoutPaymentReference(toIso(startedAt - STUCK_MAX_AGE_MS - 60 * 60 * 1000)),
      findPendingOrdersWithPaymentReferenceSince(toIso(startedAt - PENDING_MAX_AGE_MS - 60 * 60 * 1000)),
    ]);
    const bandA = withoutReference.filter((order) => isStuckCandidate(order, startedAt));
    const bandB = withReference.filter((order) => isPendingCandidate(order, startedAt, all));
    const queue = [
      ...bandA.map((order) => ({ band: "A" as const, order })),
      ...bandB.map((order) => ({ band: "B" as const, order })),
    ].slice(0, MAX_ORDERS_PER_RUN);

    const summary: Record<StuckResult, number> = {
      paid: 0,
      declined: 0,
      not_found_failed: 0,
      pending: 0,
      closed: 0,
      unverified: 0,
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
        mercadopago: async (referenceId, order) => {
          const charge = await findMercadoPagoCharge(referenceId);
          return charge
            ? { externalId: charge.chargeId, evaluation: evaluateCardCharge("mercadopago", charge, order) }
            : null;
        },
        pagbank: async (referenceId, order) => {
          const charge = await findPagBankCharge(referenceId);
          return charge
            ? { externalId: charge.chargeId, evaluation: evaluateCardCharge("pagbank", charge, order) }
            : null;
        },
        pix: readPix,
        byReference: readByReference,
      },
      // Mesmo caminho do webhook: guarda a referência (se o pedido ainda não tem) e reconcilia.
      markPaid: async (order, provider, externalId) => {
        if (dryRun) return;
        if (order.metaData["_persi_payment_reference"] !== externalId) {
          await attachPaymentReference(order.id, { provider, externalId });
        }
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
    for (const { band, order } of queue) {
      if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
      const result = band === "A" ? await reconcileStuckOrder(order, deps) : await reconcilePendingOrder(order, deps);
      summary[result] += 1;
      processed += 1;
    }

    const result = {
      dryRun,
      candidatesA: bandA.length,
      candidatesB: bandB.length,
      processed,
      truncated: processed < queue.length,
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
