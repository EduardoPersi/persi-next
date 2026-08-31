"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { EmailAutocompleteInput } from "@/components/UI/EmailAutocompleteInput";
import { RecaptchaNotice } from "@/components/UI/RecaptchaNotice";
import { useRecaptcha } from "@/hooks/useRecaptcha";

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
  const { getRecaptchaToken } = useRecaptcha();
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
    const website = String(formData.get("website") ?? "");

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
      const recaptchaToken = (await getRecaptchaToken("stock_notification_subscribe")) ?? "";
      const response = await fetch("/api/stock-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          variationId,
          email,
          website,
          consent,
          recaptchaToken,
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
    <div className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="font-bold text-primary">
        Atualmente, este produto está fora de estoque.
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        Cadastre seu e-mail e avisaremos quando ele estiver disponível
        novamente.
      </p>

      <form className="mt-4 space-y-3" noValidate onSubmit={handleSubmit}>
        <div className="sr-only" aria-hidden="true">
          <label htmlFor={`back-in-stock-website-${productId}`}>Website</label>
          <input
            id={`back-in-stock-website-${productId}`}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        <div>
          <label
            htmlFor={`back-in-stock-email-${productId}`}
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            E-mail
          </label>
          <EmailAutocompleteInput
            id={`back-in-stock-email-${productId}`}
            name="email"
            autoComplete="email"
            className="h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder="seuemail@exemplo.com"
            aria-describedby={`back-in-stock-status-${productId}`}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm leading-5 text-muted">
          <input
            name="consent"
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            Li e aceito a{" "}
            <Link
              href="/politica-de-privacidade-e-seguranca"
              className="font-medium text-primary underline hover:text-secondary"
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
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-secondary px-4 text-sm font-medium text-white transition-colors hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "submitting"
            ? "Enviando..."
            : "Avisar quando voltar ao estoque"}
        </button>
      </form>

      <p
        id={`back-in-stock-status-${productId}`}
        className={`mt-3 text-sm ${
          state === "success" ? "text-emerald-700" : "text-muted"
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
      <RecaptchaNotice className="mt-2" />

      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-emerald-600 px-4 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        aria-label={`Consultar disponibilidade de ${productName} pelo WhatsApp`}
      >
        Consultar pelo WhatsApp
      </a>
    </div>
  );
}
