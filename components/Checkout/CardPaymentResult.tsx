import Link from "next/link";
import { AlertTriangle, BadgeCheck, CreditCard } from "lucide-react";
import clsx from "clsx";
import { PaymentResultLayout } from "./PaymentResultLayout";

interface CardPaymentResultProps {
  orderId: number;
  amount: number;
  status: "paid" | "failed";
  brand?: string;
  lastDigits?: string;
  installments?: number;
}

const amountFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatBrand(brand: string): string {
  return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
}

function formatCardLabel(brand?: string, lastDigits?: string): string | null {
  if (!brand && !lastDigits) return null;
  const brandLabel = brand ? formatBrand(brand) : "Cartão";
  return lastDigits ? `${brandLabel} final ${lastDigits}` : brandLabel;
}

// Resultado final de cartão (Mercado Pago) ou carteira (PagBank) —
// pagamento síncrono: não existe estado "aguardando" como em Pix/boleto, só
// aprovado ou recusado. Usa o mesmo casco PaymentResultLayout de
// PixPaymentResult/BoletoPaymentResult, mas o painel de ação mostra o
// status em vez de uma instrução de pagamento.
export function CardPaymentResult({
  orderId,
  amount,
  status,
  brand,
  lastDigits,
  installments,
}: CardPaymentResultProps) {
  const isPaid = status === "paid";
  const cardLabel = formatCardLabel(brand, lastDigits);
  const installmentsLabel =
    installments && installments > 1 ? `em ${installments}x` : "à vista";

  return (
    <PaymentResultLayout
      orderId={orderId}
      instructions={
        isPaid ? (
          <>
            Pagamento de{" "}
            <strong className="text-foreground">{amountFormatter.format(amount)}</strong>{" "}
            aprovado com sucesso.
          </>
        ) : (
          <>
            Não foi possível aprovar o pagamento de{" "}
            <strong className="text-foreground">{amountFormatter.format(amount)}</strong>.
          </>
        )
      }
      helperText={
        isPaid
          ? "Você vai receber os detalhes do pedido por e-mail."
          : "Verifique os dados do cartão ou escolha outra forma de pagamento."
      }
    >
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        {isPaid ? (
          <BadgeCheck className="h-14 w-14 text-emerald-600" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-14 w-14 text-red-600" strokeWidth={1.5} aria-hidden="true" />
        )}
        <h2 className={clsx("text-xl font-bold", isPaid ? "text-emerald-700" : "text-red-700")}>
          {isPaid ? "Pagamento aprovado!" : "Pagamento não aprovado"}
        </h2>

        {cardLabel ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-foreground">
            <CreditCard className="h-4 w-4 text-muted" aria-hidden="true" />
            <span>{cardLabel}</span>
            {installments ? (
              <>
                <span className="text-slate-300">•</span>
                <span>{installmentsLabel}</span>
              </>
            ) : null}
          </div>
        ) : null}

        {!isPaid ? (
          <Link
            href="/checkout"
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Tentar outra forma de pagamento
          </Link>
        ) : null}
      </div>
    </PaymentResultLayout>
  );
}
