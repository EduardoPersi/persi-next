"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CheckoutSection } from "./CheckoutSection";
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
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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
      // seleção manual no texto abaixo.
    }
  };

  return (
    <CheckoutSection
      title="Pague com Pix"
      description="Abra o app do seu banco, escaneie o QR Code ou copie o código abaixo."
    >
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- QR code é gerado dinamicamente em base64 pelo Banco Inter */}
        <img
          src={`data:image/png;base64,${result.qrCodeImageBase64}`}
          alt="QR Code Pix para pagamento"
          width={220}
          height={220}
          className="rounded-xl border border-slate-200"
        />
        <div className="w-full">
          <label htmlFor="pix-copy-paste" className="mb-2 block text-sm text-slate-800">
            Pix copia e cola
          </label>
          <div className="flex gap-2">
            <input
              id="pix-copy-paste"
              readOnly
              value={result.qrCodeCopyPaste}
              className="min-h-11 w-full truncate rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            />
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copiar código Pix"
              className="min-h-11 min-w-11 rounded-xl border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50"
            >
              {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            </button>
          </div>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-slate-600">
          {secondsRemaining > 0
            ? `Expira em ${formatCountdown(secondsRemaining)}. Assim que identificarmos o pagamento, esta página é atualizada automaticamente.`
            : "Este Pix expirou sem pagamento. Volte e gere um novo código para continuar."}
        </p>
      </div>
    </CheckoutSection>
  );
}
