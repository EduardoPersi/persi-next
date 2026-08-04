"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Copy, Smartphone } from "lucide-react";
import clsx from "clsx";
import type { PixPaymentResult as PixPaymentResultData } from "@/types/payments";

// Verifica rápido nos primeiros minutos (quando a maioria paga logo depois
// de abrir o QR Code) e depois espaça as tentativas — sem isso, alguém que
// demora mais de alguns minutos pra pagar via Pix (ex.: procurando o app do
// banco) nunca veria a tela atualizar sozinha, mesmo com o pagamento já
// aprovado. O limite real de quando parar é o vencimento do Pix
// (`result.expiresAt`), não uma contagem de tentativas.
const FAST_POLL_INTERVAL_MS = 4000;
const FAST_POLL_DURATION_MS = 3 * 60 * 1000;
const SLOW_POLL_INTERVAL_MS = 15000;

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
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    getSecondsRemaining(result.expiresAt),
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsRemaining(getSecondsRemaining(result.expiresAt));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [result.expiresAt]);

  useEffect(() => {
    if (secondsRemaining <= 0) onExpired();
  }, [secondsRemaining, onExpired]);

  useEffect(() => {
    let cancelled = false;
    const pollingStartedAt = Date.now();

    const poll = async () => {
      // Nunca consulta status de uma cobrança já vencida — evita chamadas
      // desnecessárias ao Inter para um Pix que não pode mais ser pago.
      if (Date.now() >= new Date(result.expiresAt).getTime()) return;

      try {
        const response = await fetch(
          `/api/checkout/payment/status?provider=inter_pix&reference=${encodeURIComponent(result.txid)}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => null);
        if (!cancelled && body?.category === "paid") {
          onPaid();
          return;
        }
      } catch {
        // Falha de rede não interrompe o polling — tenta de novo no próximo ciclo.
      }
      if (!cancelled) {
        const nextInterval =
          Date.now() - pollingStartedAt < FAST_POLL_DURATION_MS
            ? FAST_POLL_INTERVAL_MS
            : SLOW_POLL_INTERVAL_MS;
        window.setTimeout(poll, nextInterval);
      }
    };

    const timer = window.setTimeout(poll, FAST_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [result.txid, result.expiresAt, onPaid]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.qrCodeCopyPaste);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // Sem permissão de clipboard: o código continua disponível para
      // seleção manual no texto oculto abaixo (leitores de tela / Ctrl+F).
    }
  };

  const expired = secondsRemaining <= 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
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
      </div>

      <div>
        <h1 className="text-xl font-bold text-[#0c2d72] sm:text-2xl">
          Pedido {result.orderId}
        </h1>
        <p className="mt-3 text-base leading-6 text-slate-700">
          Faça um pix de{" "}
          <strong className="text-slate-900">
            {amountFormatter.format(result.amount)}
          </strong>{" "}
          para garantir sua compra.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Assim que identificarmos o pagamento, esta página é atualizada
          automaticamente.
        </p>
      </div>
    </div>
  );
}
