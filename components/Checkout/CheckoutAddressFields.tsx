"use client";

import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
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
    control,
    register,
    setValue,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();
  const lookupPostcodeAddress = usePostcodeAddressLookup();
  const [isLookingUpAddress, setIsLookingUpAddress] = useState(false);
  // Quando o CEP não é encontrado (ou a busca falha), cai para os campos
  // manuais de sempre — o cliente nunca fica travado sem conseguir
  // completar o endereço.
  const [addressLookupFailed, setAddressLookupFailed] = useState(false);
  const isBilling = kind === "billing";
  const prefix = isBilling ? "billingAddress" : "shippingAddress";
  const addressErrors = isBilling
    ? errors.billingAddress
    : errors.shippingAddress;
  const autocompletePrefix = isBilling ? "billing" : "shipping";
  const postalCodeRegistration = register(`${prefix}.postalCode`);

  const postalCode = useWatch({ control, name: `${prefix}.postalCode` });
  const addressLine1 = useWatch({ control, name: `${prefix}.addressLine1` });
  const neighborhood = useWatch({ control, name: `${prefix}.neighborhood` });
  const city = useWatch({ control, name: `${prefix}.city` });
  const state = useWatch({ control, name: `${prefix}.state` });
  const hasResolvedAddress =
    !addressLookupFailed && Boolean(addressLine1 && city && state);
  const showAddressStep = hasResolvedAddress || addressLookupFailed;

  // Endereço vindo pronto do carrinho/conta pode não ter bairro salvo (ex.:
  // cadastro antigo cujo address_2 na Woo ficou vazio) — sem isto,
  // "Avançar" ficava travado indefinidamente já que isAddressComplete exige
  // bairro, e o campo nunca aparecia editável (só aparece quando a busca de
  // CEP falha). Busca o bairro de novo pelo CEP já resolvido, do mesmo jeito
  // que a digitação manual do CEP faz — sem exigir que o cliente reedite
  // nada. Só cai para o campo manual (abaixo) se essa busca também não
  // encontrar bairro para o CEP.
  const neighborhoodBackfillAttempted = useRef(false);
  const [neighborhoodBackfillFailed, setNeighborhoodBackfillFailed] =
    useState(false);

  useEffect(() => {
    if (neighborhoodBackfillAttempted.current) return;
    if (!hasResolvedAddress || neighborhood?.trim()) return;
    if (normalizePostcode(postalCode ?? "").length !== 8) return;
    neighborhoodBackfillAttempted.current = true;
    void lookupPostcodeAddress(postalCode)
      .then((address) => {
        if (address?.address2) {
          setValue(`${prefix}.neighborhood`, address.address2, {
            shouldDirty: true,
            shouldValidate: true,
          });
        } else {
          setNeighborhoodBackfillFailed(true);
        }
      })
      .catch(() => setNeighborhoodBackfillFailed(true));
  }, [
    hasResolvedAddress,
    neighborhood,
    postalCode,
    lookupPostcodeAddress,
    setValue,
    prefix,
  ]);

  const missingNeighborhood =
    hasResolvedAddress && !neighborhood?.trim() && neighborhoodBackfillFailed;

  const handlePostalCodeChange = (value: string) => {
    const formatted = formatPostcode(value);
    setValue(`${prefix}.postalCode`, formatted, {
      shouldDirty: true,
      shouldValidate: true,
    });

    if (normalizePostcode(formatted).length !== 8) {
      setAddressLookupFailed(false);
      return;
    }

    setIsLookingUpAddress(true);
    void lookupPostcodeAddress(formatted)
      .then((address) => {
        // `address2` do serviço de CEP carrega o bairro (não o
        // complemento) — ver services/shipping/postcode.ts.
        if (!address?.address1 || !address.city || !address.state) {
          setAddressLookupFailed(true);
          return;
        }
        setAddressLookupFailed(false);
        setValue(`${prefix}.addressLine1`, address.address1, {
          shouldDirty: true,
          shouldValidate: true,
        });
        if (address.address2) {
          setValue(`${prefix}.neighborhood`, address.address2, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
        setValue(`${prefix}.city`, address.city, {
          shouldDirty: true,
          shouldValidate: true,
        });
        setValue(`${prefix}.state`, address.state, {
          shouldDirty: true,
          shouldValidate: true,
        });
      })
      .catch(() => setAddressLookupFailed(true))
      .finally(() => setIsLookingUpAddress(false));
  };

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="sm:col-span-6">
        <CheckoutField
          id={`${kind}-postal-code`}
          label="CEP"
          required
          registration={postalCodeRegistration}
          error={addressErrors?.postalCode?.message}
          inputMode="numeric"
          maxLength={9}
          placeholder="00000-000"
          autoComplete={`${autocompletePrefix} postal-code`}
          onChange={handlePostalCodeChange}
        />
        {isLookingUpAddress ? (
          <p className="mt-1.5 text-xs text-slate-500" role="status">
            Buscando endereço...
          </p>
        ) : null}
      </div>

      {hasResolvedAddress ? (
        <div className="sm:col-span-6">
          <p className="text-xs font-semibold text-slate-700">Enviando para</p>
          <p className="text-sm text-black">
            {addressLine1}
            {neighborhood ? `, bairro ${neighborhood}` : ""}
          </p>
          <p className="text-sm text-black">
            {city} / {state}
          </p>
        </div>
      ) : null}

      {missingNeighborhood ? (
        <div className="sm:col-span-6">
          <CheckoutField
            id={`${kind}-neighborhood`}
            label="Bairro"
            required
            registration={register(`${prefix}.neighborhood`)}
            error={addressErrors?.neighborhood?.message}
            autoComplete="address-level3"
          />
        </div>
      ) : null}

      {addressLookupFailed ? (
        <>
          <div className="sm:col-span-6">
            <CheckoutField
              id={`${kind}-address-line-1`}
              label="Endereço"
              required
              registration={register(`${prefix}.addressLine1`)}
              error={addressErrors?.addressLine1?.message}
              autoComplete={`${autocompletePrefix} address-line1`}
            />
          </div>
          <div className="sm:col-span-3">
            <CheckoutField
              id={`${kind}-neighborhood`}
              label="Bairro"
              required
              registration={register(`${prefix}.neighborhood`)}
              error={addressErrors?.neighborhood?.message}
              autoComplete="address-level3"
            />
          </div>
          <div className="sm:col-span-3">
            <CheckoutField
              id={`${kind}-city`}
              label="Cidade"
              required
              registration={register(`${prefix}.city`)}
              error={addressErrors?.city?.message}
              autoComplete={`${autocompletePrefix} address-level2`}
            />
          </div>
          <div className="sm:col-span-6">
            <label
              htmlFor={`${kind}-state`}
              className="mb-1.5 block text-xs font-medium text-black"
            >
              Estado (UF)
              <span className="text-danger"> *</span>
            </label>
            <select
              id={`${kind}-state`}
              {...register(`${prefix}.state`)}
              autoComplete={`${autocompletePrefix} address-level1`}
              aria-invalid={Boolean(addressErrors?.state)}
              aria-describedby={
                addressErrors?.state ? `${kind}-state-error` : undefined
              }
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary aria-[invalid=true]:border-danger"
            >
              <option value="">Selecione</option>
              {BRAZILIAN_STATES.map((stateOption) => (
                <option key={stateOption} value={stateOption}>
                  {stateOption}
                </option>
              ))}
            </select>
            {addressErrors?.state ? (
              <p id={`${kind}-state-error`} className="mt-1.5 text-xs text-danger">
                {addressErrors.state.message}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {showAddressStep ? (
        <>
          <div className="sm:col-span-3">
            <CheckoutField
              id={`${kind}-address-number`}
              label="Número"
              required
              registration={register(`${prefix}.number`)}
              error={addressErrors?.number?.message}
              autoComplete="off"
            />
          </div>
          <div className="sm:col-span-3">
            <CheckoutField
              id={`${kind}-address-line-2`}
              label="Complemento"
              registration={register(`${prefix}.addressLine2`)}
              error={addressErrors?.addressLine2?.message}
              placeholder="Apto. etc"
              autoComplete={`${autocompletePrefix} address-line2`}
            />
          </div>
          <div className="sm:col-span-6">
            <CheckoutField
              id={`${kind}-recipient-name`}
              label="Destinatário"
              required
              registration={register(`${prefix}.recipientName`)}
              error={addressErrors?.recipientName?.message}
              autoComplete="name"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
