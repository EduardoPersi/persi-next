"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EmailAutocompleteInput } from "@/components/UI/EmailAutocompleteInput";
import { RecaptchaNotice } from "@/components/UI/RecaptchaNotice";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import {
  CONTACT_SUBJECTS,
  contactFormSchema,
  type ContactFormValues,
} from "@/lib/validation/contact";

const inputClassName =
  "min-h-11 w-full rounded-[6px] border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20";

type SubmissionState = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const { getRecaptchaToken } = useRecaptcha();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "",
      email: "",
      subject: "duvidas",
      message: "",
      website: "",
    },
  });

  async function onSubmit(values: ContactFormValues) {
    setState("submitting");
    setMessage("");

    try {
      const recaptchaToken = (await getRecaptchaToken("contact_submit")) ?? "";
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, recaptchaToken }),
      });
      const result = (await response.json()) as {
        code?: string;
        message?: string;
      };

      if (!response.ok) {
        setState("error");
        setMessage(
          result.message || "Não foi possível enviar sua mensagem. Tente novamente.",
        );
        return;
      }

      reset();
      setState("success");
      setMessage(result.message || "Mensagem enviada com sucesso.");
    } catch {
      setState("error");
      setMessage("Não foi possível enviar sua mensagem. Tente novamente.");
    }
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register("website")}
        />
      </div>

      <div>
        <label htmlFor="contact-name" className="mb-1.5 block text-sm font-medium text-slate-700">
          Nome
        </label>
        <input
          id="contact-name"
          type="text"
          placeholder="Nome"
          autoComplete="name"
          className={inputClassName}
          aria-invalid={errors.name ? "true" : undefined}
          aria-describedby={errors.name ? "contact-name-error" : undefined}
          {...register("name")}
        />
        {errors.name ? (
          <p id="contact-name-error" className="mt-1 text-xs text-red-700">
            {errors.name.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="contact-email" className="mb-1.5 block text-sm font-medium text-slate-700">
          E-mail
        </label>
        <EmailAutocompleteInput
          id="contact-email"
          placeholder="E-mail"
          autoComplete="email"
          className={inputClassName}
          aria-invalid={errors.email ? "true" : undefined}
          aria-describedby={errors.email ? "contact-email-error" : undefined}
          {...register("email")}
        />
        {errors.email ? (
          <p id="contact-email-error" className="mt-1 text-xs text-red-700">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="contact-subject" className="mb-1.5 block text-sm font-medium text-slate-700">
          Assunto
        </label>
        <select
          id="contact-subject"
          className={inputClassName}
          aria-invalid={errors.subject ? "true" : undefined}
          {...register("subject")}
        >
          {CONTACT_SUBJECTS.map((subject) => (
            <option key={subject.value} value={subject.value}>
              {subject.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="contact-message" className="mb-1.5 block text-sm font-medium text-slate-700">
          Mensagem
        </label>
        <textarea
          id="contact-message"
          rows={6}
          placeholder="Mensagem"
          className={`${inputClassName} min-h-32 resize-y py-2.5`}
          aria-invalid={errors.message ? "true" : undefined}
          aria-describedby={errors.message ? "contact-message-error" : undefined}
          {...register("message")}
        />
        {errors.message ? (
          <p id="contact-message-error" className="mt-1 text-xs text-red-700">
            {errors.message.message}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={state === "submitting"}
        className="inline-flex h-12 w-full items-center justify-center rounded-[6px] bg-[#ff6a00] px-4 text-base font-bold uppercase text-white transition-colors hover:bg-[#e85f00] active:bg-[#cc5200] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a00] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        {state === "submitting" ? "Enviando..." : "Enviar"}
      </button>

      <p
        className={`text-sm ${state === "success" ? "text-emerald-700" : "text-slate-600"}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>

      <RecaptchaNotice />
    </form>
  );
}
