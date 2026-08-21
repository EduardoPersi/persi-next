"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { CheckoutField } from "./CheckoutField";
import type { CheckoutFormValues } from "@/types/checkout";
import {
  formatBrazilianCnpj,
  formatBrazilianCpf,
  formatBrazilianPhone,
} from "@/lib/formatting/personalData";

export function CheckoutContactForm() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();
  const personType = useWatch({ control, name: "contact.personType" });
  const isCompany = personType === "juridica";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" {...register("contact.email")} />
      <CheckoutField
        id="checkout-first-name"
        label="Nome"
        required
        registration={register("contact.firstName")}
        error={errors.contact?.firstName?.message}
        autoComplete="given-name"
      />
      <CheckoutField
        id="checkout-last-name"
        label="Sobrenome"
        required
        registration={register("contact.lastName")}
        error={errors.contact?.lastName?.message}
        autoComplete="family-name"
      />
      <div className="sm:col-span-2">
        <CheckoutField
          id="checkout-phone"
          label="Celular/WhatsApp"
          required
          registration={register("contact.phone", {
            onChange: (event) => {
              event.target.value = formatBrazilianPhone(event.target.value);
            },
          })}
          error={errors.contact?.phone?.message}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={15}
          placeholder="(11) 99999-9999"
        />
      </div>
      <div className="sm:col-span-2">
        <label
          htmlFor="checkout-person-type"
          className="mb-1.5 block text-xs font-medium text-black"
        >
          Tipo de Pessoa
        </label>
        <select
          id="checkout-person-type"
          {...register("contact.personType")}
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-primary"
        >
          <option value="fisica">Pessoa Física</option>
          <option value="juridica">Pessoa Jurídica</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <CheckoutField
          id="checkout-document"
          label={isCompany ? "CNPJ" : "CPF"}
          required
          registration={register("contact.document", {
            onChange: (event) => {
              event.target.value = isCompany
                ? formatBrazilianCnpj(event.target.value)
                : formatBrazilianCpf(event.target.value);
            },
          })}
          error={errors.contact?.document?.message}
          inputMode="numeric"
          autoComplete="off"
          maxLength={isCompany ? 18 : 14}
          placeholder={isCompany ? "00.000.000/0000-00" : "000.000.000-00"}
        />
      </div>
    </div>
  );
}
