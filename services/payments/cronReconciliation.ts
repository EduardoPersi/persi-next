import { timingSafeEqual } from "node:crypto";

export function safeCompareSecret(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

const BEARER_PREFIX = "Bearer ";

// `expectedSecret` ausente/vazio sempre nega — evita o caso perigoso de
// CRON_SECRET não configurado deixando a rota efetivamente aberta.
export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): boolean {
  const expected = expectedSecret?.trim();
  if (!expected) return false;
  const header = authorizationHeader ?? "";
  return header.startsWith(BEARER_PREFIX) && safeCompareSecret(header.slice(BEARER_PREFIX.length), expected);
}

export type ReconciliationCategory = "paid" | "pending" | "failed";

export interface ReconciliationSummary {
  checked: number;
  paid: number;
  failed: number;
  pending: number;
  errors: number;
  truncated: boolean;
  remaining: number;
  durationMs: number;
}

export interface ReconcilePendingOrdersOptions<TOrder> {
  timeBudgetMs: number;
  concurrency: number;
  reconcileOrder: (order: TOrder) => Promise<ReconciliationCategory>;
  getOrderId: (order: TOrder) => number | string;
  onOrderError?: (order: TOrder, error: unknown) => void;
  now?: () => number;
}

function createEmptySummary(): ReconciliationSummary {
  return {
    checked: 0,
    paid: 0,
    failed: 0,
    pending: 0,
    errors: 0,
    truncated: false,
    remaining: 0,
    durationMs: 0,
  };
}

// Processa em lotes de tamanho `concurrency`, checando o orçamento de tempo
// antes de iniciar cada lote — nunca inicia trabalho novo depois que o
// orçamento estourou, mesmo que um lote em andamento ainda esteja rodando.
// Isolado do transporte HTTP e das chamadas reais a Inter/PagBank/WooCommerce
// para poder ser testado com dependências injetadas (sem rede, sem relógio
// real).
export async function reconcilePendingOrders<TOrder>(
  orders: TOrder[],
  options: ReconcilePendingOrdersOptions<TOrder>,
): Promise<ReconciliationSummary> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const summary = createEmptySummary();

  let index = 0;
  while (index < orders.length) {
    if (now() - startedAt >= options.timeBudgetMs) {
      summary.truncated = true;
      summary.remaining = orders.length - index;
      break;
    }

    const batch = orders.slice(index, index + options.concurrency);
    index += batch.length;

    await Promise.all(
      batch.map(async (order) => {
        summary.checked += 1;
        try {
          const category = await options.reconcileOrder(order);
          summary[category] += 1;
        } catch (error) {
          summary.errors += 1;
          options.onOrderError?.(order, error);
        }
      }),
    );
  }

  summary.durationMs = now() - startedAt;
  return summary;
}

// Guarda de execução única por processo — impede que duas chamadas
// sobrepostas do cron rodem ao mesmo tempo e disputem os mesmos pedidos.
// Não protege contra múltiplos processos/instâncias do app rodando em
// paralelo (ver observação em app/api/cron/expire-pending-payments/route.ts).
export function createOverlapGuard() {
  let running = false;
  return {
    tryAcquire(): boolean {
      if (running) return false;
      running = true;
      return true;
    },
    release(): void {
      running = false;
    },
    get isRunning(): boolean {
      return running;
    },
  };
}
