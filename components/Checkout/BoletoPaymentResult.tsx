"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { CheckoutSection } from "./CheckoutSection";
import type { BoletoPaymentResult as BoletoPaymentResultData } from "@/types/payments";

interface BoletoPaymentResultProps {
  result: BoletoPaymentResultData;
}

function formatDueDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

export function BoletoPaymentResult({ result }: BoletoPaymentResultProps) {
  const [copied, setCopied] = useState(false);
  const formattedDueDate = formatDueDate(result.dueDate);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.digitableLine);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // Sem permissão de clipboard: a linha digitável continua disponível
      // para seleção manual no texto abaixo.
    }
  };

  return (
    <CheckoutSection
      title="Pague com boleto"
      description={
        formattedDueDate
          ? `Válido até ${formattedDueDate}. A compensação pode levar até 2 dias úteis após o pagamento.`
          : "A compensação pode levar até 2 dias úteis após o pagamento."
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="boleto-digitable-line" className="mb-2 block text-sm text-slate-800">
            Linha digitável
          </label>
          <div className="flex gap-2">
            <input
              id="boleto-digitable-line"
              readOnly
              value={result.digitableLine}
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
        <p className="text-sm text-slate-600">
          Guarde o número do pedido para acompanhar o pagamento em Minha Conta.
        </p>
      </div>
    </CheckoutSection>
  );
}
