"use client";

import { useState } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { usePaymentStatusPolling } from "@/hooks/usePaymentStatusPolling";
import type { BoletoPaymentResult as BoletoPaymentResultData } from "@/types/payments";
import { PaymentResultLayout } from "./PaymentResultLayout";

interface BoletoPaymentResultProps {
  result: BoletoPaymentResultData;
  onPaid: () => void;
}

interface BoletoDetails {
  digitableLine: string;
  barcode: string;
  dueDate: string;
}

function formatDueDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

const amountFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function BoletoPaymentResult({ result, onPaid }: BoletoPaymentResultProps) {
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState<BoletoDetails>({
    digitableLine: result.digitableLine,
    barcode: result.barcode,
    dueDate: result.dueDate,
  });

  const isGenerating = !details.digitableLine;

  // A emissão no Inter é assíncrona: a criação do pedido já tenta algumas
  // vezes até a linha digitável ficar pronta (ver createBoletoCharge), mas
  // se ainda não tiver saído, reconsulta aqui até aparecer. A mesma chamada
  // também serve para detectar o pagamento (categoria "paid") e levar direto
  // à confirmação, sem exigir que o cliente volte à página manualmente.
  usePaymentStatusPolling({
    enabled: true,
    onTick: async () => {
      const response = await fetch(
        `/api/checkout/payment/status?provider=inter_boleto&reference=${encodeURIComponent(result.requestCode)}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => null);
      if (!body) return;

      if (body.digitableLine) {
        setDetails({
          digitableLine: body.digitableLine,
          barcode: body.barcode ?? "",
          dueDate: body.dueDate || result.dueDate,
        });
      }

      if (body.category === "paid") {
        onPaid();
        return "stop";
      }
      if (body.category === "failed") return "stop";
    },
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(details.digitableLine);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // Sem permissão de clipboard: a linha digitável continua disponível
      // para seleção manual no campo abaixo.
    }
  };

  const formattedDueDate = formatDueDate(details.dueDate);

  return (
    <PaymentResultLayout
      orderId={result.orderId}
      instructions={
        <>
          Pague o boleto de{" "}
          <strong className="text-slate-900">
            {amountFormatter.format(result.amount)}
          </strong>
          {formattedDueDate ? (
            <>
              {" "}
              até <strong className="text-slate-900">{formattedDueDate}</strong>
            </>
          ) : null}{" "}
          para garantir sua compra.
        </>
      }
      helperText="Assim que identificarmos o pagamento, esta página é atualizada automaticamente. A compensação pode levar até 2 dias úteis."
    >
      {isGenerating ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-slate-600">Gerando seu boleto, aguarde um instante…</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="boleto-digitable-line" className="mb-2 block text-sm text-slate-800">
              Linha digitável
            </label>
            <div className="flex gap-2">
              <input
                id="boleto-digitable-line"
                readOnly
                value={details.digitableLine}
                className="min-h-11 w-full truncate rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copiar linha digitável"
                className="min-h-11 min-w-11 rounded-xl border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50"
              >
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <a
            href={`/api/checkout/payment/boleto-pdf?reference=${encodeURIComponent(result.requestCode)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Baixar boleto (PDF)
          </a>

          <p className="text-sm text-slate-600">
            Guarde o número do pedido para acompanhar o pagamento em Minha Conta.
          </p>
        </div>
      )}
    </PaymentResultLayout>
  );
}
