"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

interface BackInStockFormProps {
  productId: number;
  productName: string;
  productUrl: string;
  integrationEnabled: boolean;
  variationId?: number;
  requiresVariation?: boolean;
}

type SubmissionState = "idle" | "submitting" | "success" | "error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BackInStockForm({
  productId,
  productName,
  productUrl,
  integrationEnabled,
  variationId,
  requiresVariation = false,
}: BackInStockFormProps) {
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const variationPending = requiresVariation && !variationId;
  const whatsappMessage = encodeURIComponent(
    `Olá, gostaria de consultar a disponibilidade do produto ${productName}. ${productUrl}`,
  );
  const whatsappUrl = `https://wa.me/551139648294?text=${whatsappMessage}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    const consent = formData.get("consent") === "on";

    if (!EMAIL_PATTERN.test(email)) {
      setState("error");
      setMessage("Informe um e-mail válido.");
      return;
    }

    if (!consent) {
      setState("error");
      setMessage("Aceite a Política de Privacidade para continuar.");
      return;
    }

    if (!integrationEnabled || variationPending) {
      return;
    }

    setState("submitting");
    setMessage("");

    try {
      const response = await fetch("/api/stock-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          variationId,
          email,
          consent,
        }),
      });
      const result = (await response.json()) as {
        code?: string;
        message?: string;
      };

      if (!response.ok) {
        setState("error");
        setMessage(
          result.code === "already_registered"
            ? "Este e-mail já está cadastrado para este produto."
            : result.message ||
                "Não foi possível concluir o cadastro. Tente novamente.",
        );
        return;
      }

      form.reset();
      setState("success");
      setMessage(
        "Cadastro realizado. Avisaremos quando este produto voltar ao estoque.",
      );
    } catch {
      setState("error");
      setMessage("Não foi possível concluir o cadastro. Tente novamente.");
    }
  }

  return (
    <div className="w-full min-w-0 max-w-full rounded-[12px] border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="font-bold text-[#0c2d72]">
        Atualmente, este produto está fora de estoque.
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Cadastre seu e-mail e avisaremos quando ele estiver disponível
        novamente.
      </p>

      <form className="mt-4 space-y-3" noValidate onSubmit={handleSubmit}>
        <div>
          <label
            htmlFor={`back-in-stock-email-${productId}`}
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            E-mail
          </label>
          <input
            id={`back-in-stock-email-${productId}`}
            name="email"
            type="email"
            autoComplete="email"
            className="h-11 w-full min-w-0 max-w-full rounded-[6px] border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20"
            placeholder="seuemail@exemplo.com"
            aria-describedby={`back-in-stock-status-${productId}`}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm leading-5 text-slate-600">
          <input
            name="consent"
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#0c2d72]"
          />
          <span>
            Li e aceito a{" "}
            <Link
              href="/politica-de-privacidade"
              className="font-medium text-[#0c2d72] underline hover:text-[#ff6a00]"
            >
              Política de Privacidade
            </Link>
            .
          </span>
        </label>

        <button
          type="submit"
          disabled={
            state === "submitting" ||
            !integrationEnabled ||
            variationPending
          }
          className="inline-flex h-11 w-full items-center justify-center rounded-[6px] bg-[#ff6a00] px-4 text-sm font-medium text-white transition-colors hover:bg-[#e85f00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a00] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "submitting"
            ? "Enviando..."
            : "Avisar quando voltar ao estoque"}
        </button>
      </form>

      <p
        id={`back-in-stock-status-${productId}`}
        className={`mt-3 text-sm ${
          state === "success" ? "text-emerald-700" : "text-slate-600"
        }`}
        role="status"
        aria-live="polite"
      >
        {variationPending
          ? "Selecione uma variação antes de cadastrar o aviso."
          : !integrationEnabled
            ? "O cadastro por e-mail estará disponível em breve."
            : message}
      </p>

      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-[6px] border border-emerald-600 px-4 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        aria-label={`Consultar disponibilidade de ${productName} pelo WhatsApp`}
      >
        Consultar pelo WhatsApp
      </a>
    </div>
  );
}
