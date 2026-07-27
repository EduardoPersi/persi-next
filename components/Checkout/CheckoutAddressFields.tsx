"use client";

import { useFormContext } from "react-hook-form";
import { formatPostalCode } from "@/lib/commerce/checkout";
import { BRAZILIAN_STATES } from "@/lib/constants/brazilianStates";
import type { CheckoutFormValues } from "@/types/checkout";
import { CheckoutField } from "./CheckoutField";

interface CheckoutAddressFieldsProps {
  kind: "billing" | "shipping";
}

export function CheckoutAddressFields({
  kind,
}: CheckoutAddressFieldsProps) {
  const {
    register,
    setValue,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();
  const isBilling = kind === "billing";
  const prefix = isBilling ? "billingAddress" : "shippingAddress";
  const addressErrors = isBilling
    ? errors.billingAddress
    : errors.shippingAddress;
  const autocompletePrefix = isBilling ? "billing" : "shipping";
  const postalCodeRegistration = register(`${prefix}.postalCode`);

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <CheckoutField
          id={`${kind}-postal-code`}
          label="CEP"
          registration={postalCodeRegistration}
          error={addressErrors?.postalCode?.message}
          inputMode="numeric"
          maxLength={9}
          placeholder="00000-000"
          autoComplete={`${autocompletePrefix} postal-code`}
          onChange={(value) => {
            setValue(`${prefix}.postalCode`, formatPostalCode(value), {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
        />
      </div>
      <div className="sm:col-span-4">
        <CheckoutField
          id={`${kind}-address-line-1`}
          label="Endereço"
          registration={register(`${prefix}.addressLine1`)}
          error={addressErrors?.addressLine1?.message}
          autoComplete={`${autocompletePrefix} address-line1`}
        />
      </div>
      <div className="sm:col-span-2">
        <CheckoutField
          id={`${kind}-address-number`}
          label="Número"
          registration={register(`${prefix}.number`)}
          error={addressErrors?.number?.message}
          autoComplete="off"
        />
      </div>
      <div className="sm:col-span-4">
        <CheckoutField
          id={`${kind}-address-line-2`}
          label="Complemento (opcional)"
          registration={register(`${prefix}.addressLine2`)}
          error={addressErrors?.addressLine2?.message}
          autoComplete={`${autocompletePrefix} address-line2`}
        />
      </div>
      <div className="sm:col-span-3">
        <CheckoutField
          id={`${kind}-neighborhood`}
          label="Bairro"
          registration={register(`${prefix}.neighborhood`)}
          error={addressErrors?.neighborhood?.message}
          autoComplete="address-level3"
        />
      </div>
      <div className="sm:col-span-3">
        <CheckoutField
          id={`${kind}-city`}
          label="Cidade"
          registration={register(`${prefix}.city`)}
          error={addressErrors?.city?.message}
          autoComplete={`${autocompletePrefix} address-level2`}
        />
      </div>
      <div className="sm:col-span-2">
        <label
          htmlFor={`${kind}-state`}
          className="mb-2 block text-sm text-slate-800"
        >
          Estado (UF)
        </label>
        <select
          id={`${kind}-state`}
          {...register(`${prefix}.state`)}
          autoComplete={`${autocompletePrefix} address-level1`}
          aria-invalid={Boolean(addressErrors?.state)}
          aria-describedby={
            addressErrors?.state ? `${kind}-state-error` : undefined
          }
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 aria-[invalid=true]:border-danger"
        >
          <option value="">Selecione</option>
          {BRAZILIAN_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        {addressErrors?.state ? (
          <p id={`${kind}-state-error`} className="mt-1.5 text-sm text-danger">
            {addressErrors.state.message}
          </p>
        ) : null}
      </div>
      <div className="sm:col-span-4">
        <label
          htmlFor={`${kind}-country`}
          className="mb-2 block text-sm text-slate-800"
        >
          País
        </label>
        <input
          id={`${kind}-country`}
          value="Brasil"
          readOnly
          aria-readonly="true"
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
        />
      </div>
    </div>
  );
}
