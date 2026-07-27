import { CheckoutSection } from "./CheckoutSection";

export function CheckoutPaymentPlaceholder() {
  return (
    <CheckoutSection title="Pagamento">
      <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        As formas de pagamento serão exibidas após a confirmação do endereço e
        da entrega.
      </p>
    </CheckoutSection>
  );
}
