"use client";

import { useFormContext } from "react-hook-form";
import { CheckoutField } from "./CheckoutField";
import { CheckoutSection } from "./CheckoutSection";
import type { CheckoutFormValues } from "@/types/checkout";

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
        <div className="sm:col-span-2">
          <CheckoutField
            id="checkout-phone"
            label="Telefone"
            registration={register("contact.phone")}
            error={errors.contact?.phone?.message}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
      </div>

      {/* Ponto único de extensão para CPF/CNPJ e tipo de pessoa após a auditoria
          das meta keys brasileiras no WordPress/WooCommerce. */}
    </CheckoutSection>
  );
}
