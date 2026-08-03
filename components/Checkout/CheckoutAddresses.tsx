"use client";

import { useFormContext, useWatch } from "react-hook-form";
import type { CheckoutFormValues } from "@/types/checkout";
import { CheckoutAddressFields } from "./CheckoutAddressFields";

export function CheckoutAddresses() {
  const { control, register } = useFormContext<CheckoutFormValues>();
  const shipToBillingAddress = useWatch({
    control,
    name: "shipToBillingAddress",
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 text-sm font-bold text-slate-700">
          Endereço de cobrança
        </h3>
        <CheckoutAddressFields kind="billing" />
      </div>

      <div className="border-t border-slate-200 pt-5">
        <label className="flex min-h-11 items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            {...register("shipToBillingAddress")}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-primary"
          />
          <span>Entregar no mesmo endereço de cobrança</span>
        </label>

        {!shipToBillingAddress ? (
          <div className="mt-5 border-t border-slate-200 pt-5">
            <CheckoutAddressFields kind="shipping" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
