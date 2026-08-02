"use client";

import { useFormContext } from "react-hook-form";
import { CheckoutField } from "./CheckoutField";
import { CheckoutSection } from "./CheckoutSection";
import type { CheckoutFormValues } from "@/types/checkout";
import { formatBrazilianDocument, formatBrazilianPhone } from "@/lib/formatting/personalData";

export function CheckoutContactForm() {
  const {
    register,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();

  return (
    <CheckoutSection
      title="Identificação"
      description="Usaremos estes dados somente para o atendimento desta compra."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <CheckoutField
            id="checkout-email"
            label="E-mail"
            registration={register("contact.email")}
            error={errors.contact?.email?.message}
            type="email"
            inputMode="email"
            autoComplete="email"
          />
        </div>
        <CheckoutField
          id="checkout-first-name"
          label="Nome"
          registration={register("contact.firstName")}
          error={errors.contact?.firstName?.message}
          autoComplete="given-name"
        />
        <CheckoutField
          id="checkout-last-name"
          label="Sobrenome"
          registration={register("contact.lastName")}
          error={errors.contact?.lastName?.message}
          autoComplete="family-name"
        />
        <div className="sm:col-span-2">
          <CheckoutField
            id="checkout-company"
            label="Empresa (opcional)"
            registration={register("contact.company")}
            error={errors.contact?.company?.message}
            autoComplete="organization"
          />
        </div>
        <CheckoutField
          id="checkout-phone"
          label="Telefone"
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
        <CheckoutField
          id="checkout-document"
          label="CPF ou CNPJ"
          registration={register("contact.document", {
            onChange: (event) => {
              event.target.value = formatBrazilianDocument(event.target.value);
            },
          })}
          error={errors.contact?.document?.message}
          inputMode="numeric"
          autoComplete="off"
          maxLength={18}
          placeholder="000.000.000-00 ou 00.000.000/0000-00"
        />
      </div>
    </CheckoutSection>
  );
}
