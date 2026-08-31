"use client";

import Link from "next/link";
import { useFormContext } from "react-hook-form";
import type { CheckoutFormValues } from "@/types/checkout";

export function CheckoutTerms() {
  const {
    register,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();
  const errorId = "checkout-terms-error";

  return (
    <div>
      <label className="flex items-start gap-3 text-xs leading-6 text-foreground">
        <input
          type="checkbox"
          {...register("acceptsTerms")}
          aria-invalid={Boolean(errors.acceptsTerms)}
          aria-describedby={errors.acceptsTerms ? errorId : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-primary"
        />
        <span>
          Li e aceito os{" "}
          <Link
            href="/termos-de-uso"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-2"
          >
            Termos e Condições
          </Link>{" "}
          e a{" "}
          <Link
            href="/politica-de-privacidade-e-seguranca"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-2"
          >
            Política de Privacidade
          </Link>
          .
        </span>
      </label>
      {errors.acceptsTerms ? (
        <p id={errorId} className="mt-2 text-xs text-danger">
          {errors.acceptsTerms.message}
        </p>
      ) : null}
    </div>
  );
}
