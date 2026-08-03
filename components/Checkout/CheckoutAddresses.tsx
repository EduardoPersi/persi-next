"use client";

import { CheckoutAddressFields } from "./CheckoutAddressFields";

// A loja usa um único endereço: o de cobrança também é o de entrega. Não
// há mais opção de informar um endereço de entrega diferente.
export function CheckoutAddresses() {
  return (
    <div>
      <CheckoutAddressFields kind="billing" />
    </div>
  );
}
