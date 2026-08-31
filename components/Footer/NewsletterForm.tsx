"use client";

import { useState, type FormEvent } from "react";
import { EmailAutocompleteInput } from "@/components/UI/EmailAutocompleteInput";
import { RecaptchaNotice } from "@/components/UI/RecaptchaNotice";
import { useRecaptcha } from "@/hooks/useRecaptcha";

type SubmissionState = "idle" | "submitting" | "success" | "error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewsletterForm() {
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const { getRecaptchaToken } = useRecaptcha();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    const website = String(formData.get("website") ?? "");

    if (!EMAIL_PATTERN.test(email)) {
      setState("error");
      setMessage("Informe um e-mail válido.");
      return;
    }

    setState("submitting");
    setMessage("");

    try {
      const recaptchaToken = (await getRecaptchaToken("newsletter_subscribe")) ?? "";
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website, consent: true, recaptchaToken }),
      });
      const result = (await response.json()) as {
        code?: string;
        message?: string;
      };

      if (!response.ok) {
        setState("error");
        setMessage(
          result.message || "Não foi possível concluir a inscrição. Tente novamente.",
        );
        return;
      }

      form.reset();
      setState("success");
      setMessage(result.message || "Confira seu e-mail para confirmar a inscrição.");
    } catch {
      setState("error");
      setMessage("Não foi possível concluir a inscrição. Tente novamente.");
    }
  }

  return (
    <form
      className="mx-auto flex w-full max-w-[92%] flex-col gap-2 md:mx-0 md:max-w-none lg:w-[720px]"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-2 md:flex-row md:gap-3">
        <div className="sr-only" aria-hidden="true">
          <label htmlFor="footer-website">Website</label>
          <input
            id="footer-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        <label htmlFor="footer-email" className="sr-only">
          E-mail
        </label>
        <div className="w-full md:min-w-0 md:flex-1">
          <EmailAutocompleteInput
            id="footer-email"
            name="email"
            placeholder="E-mail"
            autoComplete="email"
            aria-describedby="footer-newsletter-status"
            className="box-border h-11 w-full min-w-0 rounded-xl border border-border bg-white px-4 text-sm leading-normal text-foreground outline-none placeholder:text-muted focus:border-link focus:ring-2 focus:ring-link/20"
          />
        </div>
        <button
          type="submit"
          disabled={state === "submitting"}
          className="box-border flex h-11 min-h-0 w-full items-center justify-center rounded-xl bg-secondary px-8 text-sm font-medium leading-normal text-white transition-colors duration-200 hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:cursor-not-allowed disabled:opacity-70 md:w-auto"
        >
          {state === "submitting" ? "Enviando..." : "ENVIAR"}
        </button>
      </div>

      <p
        id="footer-newsletter-status"
        role="status"
        aria-live="polite"
        className={`text-center text-sm md:text-left ${
          state === "success" ? "text-white" : "text-orange-200"
        }`}
      >
        {message}
      </p>
      <RecaptchaNotice tone="light" className="text-center md:text-left" />
    </form>
  );
}
