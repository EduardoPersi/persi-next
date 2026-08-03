"use client";

import { useFormContext, useWatch } from "react-hook-form";
import type { CheckoutFormValues } from "@/types/checkout";

export function CheckoutOrderNote() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();
  const includeOrderNote = useWatch({ control, name: "includeOrderNote" });
  const errorId = "checkout-order-note-error";

  return (
    <div className="border-t border-slate-200 pt-5">
      <label className="flex min-h-11 items-start gap-3 text-xs text-black">
        <input
          type="checkbox"
          {...register("includeOrderNote")}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-primary"
        />
        <span>Incluir informações adicionais</span>
      </label>

      {includeOrderNote ? (
        <div className="mt-3">
          <label
            htmlFor="checkout-order-note"
            className="mb-1.5 block text-xs font-medium text-black"
          >
            Observações do pedido
          </label>
          <textarea
            id="checkout-order-note"
            rows={3}
            maxLength={500}
            placeholder="Observações sobre seu pedido, ex.: observações especiais sobre entrega."
            aria-invalid={Boolean(errors.orderNote)}
            aria-describedby={errors.orderNote ? errorId : undefined}
            {...register("orderNote")}
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary aria-[invalid=true]:border-danger"
          />
          {errors.orderNote ? (
            <p id={errorId} className="mt-1.5 text-xs text-danger">
              {errors.orderNote.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
