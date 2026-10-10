import {
  clearPendingPayment,
  readPendingPayment,
  type PendingStorage,
} from "./pendingPayment.ts";
import { nextIdempotencyKey } from "./paymentRetry.ts";
import { pollPaymentAttempt, type PollCheck } from "./paymentPolling.ts";

/**
 * Retomar uma chave de pagamento pendente ao abrir o checkout.
 *
 * Quem recarrega a página durante (ou depois de) uma tentativa de resultado
 * incerto NÃO ganha uma chave nova nem a liberação de outro pagamento: antes de
 * tudo, o estado da chave guardada é consultado (só leitura), com a mesma
 * espera do pagamento em processamento (a cada 5 s, até 2 minutos).
 *
 *   none       nada pendente (ou com 30 min ou mais, ignorada): libera como sempre;
 *   created    a cobrança existe: vai para a página do pedido (a chave sai);
 *   created_simple  idem, mas o navegador só provou ser o dono pela chave (Cart-Token
 *              antigo): confirmação simples com o número do pedido, sem dados;
 *   declined   recusa definitiva: a chave sai e o fluxo da recusa começa
 *              (chave NOVA + "Pagar com Pix");
 *   not_found  a tentativa nunca existiu: a chave sai e libera normalmente;
 *   timeout    2 min sem confirmação: mensagem final, SEM liberar pagamento
 *              (a chave continua guardada);
 *   cancelled  o cliente saiu da página.
 */
export type ResumeResult =
  | { kind: "none" }
  | { kind: "created"; confirmationUrl: string }
  | { kind: "created_simple"; orderNumber: number }
  | { kind: "declined"; newKey: string }
  | { kind: "not_found" }
  | { kind: "timeout" }
  | { kind: "cancelled" };

export async function resumePendingPayment(options: {
  storage: PendingStorage | null;
  check: (key: string) => Promise<PollCheck | null>;
  wait: (ms: number) => Promise<void>;
  generateKey: () => string;
  now?: () => number;
  isCancelled?: () => boolean;
}): Promise<ResumeResult> {
  const now = options.now ?? Date.now;
  const pending = readPendingPayment(options.storage, now());
  if (!pending) return { kind: "none" };

  const polled = await pollPaymentAttempt({
    check: () => options.check(pending.key),
    wait: options.wait,
    now,
    isCancelled: options.isCancelled,
    stopOnNotFound: true,
  });

  switch (polled.kind) {
    case "created":
      clearPendingPayment(options.storage);
      return { kind: "created", confirmationUrl: polled.confirmationUrl };
    case "created_simple":
      clearPendingPayment(options.storage);
      return { kind: "created_simple", orderNumber: polled.orderNumber };
    case "declined":
      clearPendingPayment(options.storage);
      return {
        kind: "declined",
        newKey: nextIdempotencyKey(
          pending.key,
          { status: 402, code: "CARD_PAYMENT_DECLINED" },
          options.generateKey,
        ),
      };
    case "not_found":
      clearPendingPayment(options.storage);
      return { kind: "not_found" };
    case "cancelled":
      return { kind: "cancelled" };
    default:
      return { kind: "timeout" };
  }
}
