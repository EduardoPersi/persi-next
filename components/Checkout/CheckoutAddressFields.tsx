"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { usePostcodeAddressLookup } from "@/hooks/usePostcodeAddressLookup";
import { formatPostcode, normalizePostcode } from "@/lib/commerce/shippingCalculator";
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
  const lookupPostcodeAddress = usePostcodeAddressLookup();
  const [isLookingUpAddress, setIsLookingUpAddress] = useState(false);
  const isBilling = kind === "billing";
  const prefix = isBilling ? "billingAddress" : "shippingAddress";
  const addressErrors = isBilling
    ? errors.billingAddress
    : errors.shippingAddress;
  const autocompletePrefix = isBilling ? "billing" : "shipping";
  const postalCodeRegistration = register(`${prefix}.postalCode`);

  const handlePostalCodeChange = (value: string) => {
    const formatted = formatPostcode(value);
    setValue(`${prefix}.postalCode`, formatted, {
      shouldDirty: true,
      shouldValidate: true,
    });

    if (normalizePostcode(formatted).length !== 8) return;

    setIsLookingUpAddress(true);
    void lookupPostcodeAddress(formatted)
      .then((address) => {
        // CEP não encontrado: campo de CEP continua com o valor digitado,
        // sem travar a tela — o cliente sempre pode preencher manualmente.
        if (!address) return;
        // `address2` do serviço de CEP carrega o bairro (não o
        // complemento) — ver services/shipping/postcode.ts.
        if (address.address1) {
          setValue(`${prefix}.addressLine1`, address.address1, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
        if (address.address2) {
          setValue(`${prefix}.neighborhood`, address.address2, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
        if (address.city) {
          setValue(`${prefix}.city`, address.city, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
        if (address.state) {
          setValue(`${prefix}.state`, address.state, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
      })
      .finally(() => setIsLookingUpAddress(false));
  };

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
          onChange={handlePostalCodeChange}
        />
        {isLookingUpAddress ? (
          <p className="mt-1.5 text-sm text-slate-500" role="status">
            Buscando endereço...
          </p>
        ) : null}
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
