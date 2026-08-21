"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, Copy, Smartphone } from "lucide-react";
import clsx from "clsx";
import { usePaymentStatusPolling } from "@/hooks/usePaymentStatusPolling";
import type { PixPaymentResult as PixPaymentResultData } from "@/types/payments";
import { PaymentResultLayout } from "./PaymentResultLayout";

interface PixPaymentResultProps {
  result: PixPaymentResultData;
  onPaid: () => void;
  onExpired: () => void;
}

function getSecondsRemaining(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

const amountFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function PixPaymentResult({ result, onPaid, onExpired }: PixPaymentResultProps) {
  const [copied, setCopied] = useState(false);
  const copyFieldRef = useRef<HTMLInputElement>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    getSecondsRemaining(result.expiresAt),
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsRemaining(getSecondsRemaining(result.expiresAt));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [result.expiresAt]);

  const expired = secondsRemaining <= 0;

  usePaymentStatusPolling({
    enabled: true,
    onTick: async (signal) => {
      // Nunca consulta status de uma cobrança já vencida — evita chamadas
      // desnecessárias ao Inter para um Pix que não pode mais ser pago.
      const response = await fetch(
        `/api/checkout/payment/status?provider=inter_pix&reference=${encodeURIComponent(result.txid)}`,
        { cache: "no-store", signal },
      );
      const body = await response.json().catch(() => null);
      if (body?.category === "paid") {
        onPaid();
        return "stop";
      }
      if (body?.category === "failed") {
        onExpired();
        return "stop";
      }
    },
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.qrCodeCopyPaste);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      copyFieldRef.current?.select();
      if (document.execCommand("copy")) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 3000);
      }
      // Sem permissão de clipboard: o código continua disponível para
      // seleção manual no texto oculto abaixo (leitores de tela / Ctrl+F).
    }
  };

  return (
    <PaymentResultLayout
      orderId={result.orderId}
      instructions={
        <>
          Faça um pix de{" "}
          <strong className="text-slate-900">
            {amountFormatter.format(result.amount)}
          </strong>{" "}
          para garantir sua compra.
        </>
      }
      helperText="Assim que identificarmos o pagamento, esta página é atualizada automaticamente."
    >
      <p className="text-center text-sm leading-6 text-slate-700">
        Abra seu aplicativo de pagamentos Pix e escolha a opção{" "}
        <strong className="text-slate-900">Ler QR Code</strong>
      </p>

      <div className="mt-4 flex justify-center">
        <span
          role="status"
          aria-live="polite"
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
            expired
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-amber-200 bg-amber-50 text-amber-800 animate-pulse",
          )}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
          {expired ? "Expirado" : formatCountdown(secondsRemaining)}
        </span>
      </div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
        <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
        Aponte a câmera
      </p>

      <div className="mt-4 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- QR code é gerado dinamicamente em base64 no servidor */}
        <img
          src={`data:image/png;base64,${result.qrCodeImageBase64}`}
          alt="QR Code Pix para pagamento"
          width={220}
          height={220}
          className="rounded-xl border border-slate-200"
        />
      </div>

      <p className="mt-5 text-center text-xs leading-5 text-slate-600">
        Se preferir, utilize o código <strong>Pix Copia e Cola</strong> no seu
        aplicativo de pagamentos ou Internet Banking. Para isso, clique no botão
        abaixo para copiar o código e realizar o pagamento.
      </p>

      <label htmlFor="pix-copy-paste" className="mt-5 block text-sm font-medium text-slate-800">
        Pix copia e cola
      </label>
      <input
        ref={copyFieldRef}
        id="pix-copy-paste"
        readOnly
        value={result.qrCodeCopyPaste}
        className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
      />
      <button
        type="button"
        onClick={handleCopy}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )}
        {copied ? "Código copiado!" : "Copiar código"}
      </button>
      <span className="sr-only">{result.qrCodeCopyPaste}</span>

      {expired ? (
        <p className="mt-3 text-center text-xs text-red-700">
          Este Pix expirou sem pagamento. Volte e gere um novo código para continuar.
        </p>
      ) : null}
    </PaymentResultLayout>
  );
}
