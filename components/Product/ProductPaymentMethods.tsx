"use client";

import {
  Barcode,
  ChevronRight,
  CreditCard,
  X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useOverlayManager } from "@/hooks/useOverlayManager";
import type { ProductPaymentInfo } from "@/lib/commerce/productPayment";
import { PixIcon } from "./PixIcon";

interface ProductPaymentMethodsProps {
  payment: ProductPaymentInfo;
  currencyCode: string;
}

type PaymentMethod = "credit-card" | "pix" | "bank-slip";

const PAYMENT_METHODS: Array<{
  id: PaymentMethod;
  label: string;
}> = [
  { id: "credit-card", label: "Cartão de crédito" },
  { id: "pix", label: "Pix" },
  { id: "bank-slip", label: "Boleto bancário" },
];

export function ProductPaymentMethods({
  payment,
  currencyCode,
}: ProductPaymentMethodsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeMethod, setActiveMethod] =
    useState<PaymentMethod>("credit-card");
  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode,
  });

  useOverlayManager({
    id: `product-payment-methods-${titleId}`,
    isOpen: isDialogOpen,
    onClose: closeDialog,
    returnFocusRef: triggerRef,
    closeOnEscape: false,
  });

  function openDialog() {
    dialogRef.current?.showModal();
    setIsDialogOpen(true);
  }

  function closeDialog() {
    dialogRef.current?.close();
    setIsDialogOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className="mt-5 flex min-h-12 w-full items-center gap-2 border-t border-slate-200 pt-4 text-left text-sm font-medium text-foreground transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-haspopup="dialog"
      >
        <span className="flex items-center gap-1.5 text-muted" aria-hidden="true">
          <CreditCard className="h-4 w-4" />
          <PixIcon className="h-4 w-4" />
          <Barcode className="h-4 w-4" />
        </span>
        <span className="flex-1">Mais formas de pagamento</span>
        <ChevronRight className="h-5 w-5 text-secondary" aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setIsDialogOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-xl bg-white p-0 text-foreground shadow-2xl backdrop:bg-slate-950/60"
      >
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
            <h2 id={titleId} className="text-xl font-bold text-primary sm:text-2xl">
              Mais formas de pagamento
            </h2>
            <button
              type="button"
              onClick={closeDialog}
              aria-label="Fechar formas de pagamento"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </header>

          <div className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
              aria-label="Formas de pagamento"
            >
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => setActiveMethod(method.id)}
                  aria-pressed={activeMethod === method.id}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    activeMethod === method.id
                      ? "border-primary bg-primary text-white"
                      : "border-slate-200 bg-white text-foreground hover:border-slate-400"
                  }`}
                >
                  {method.id === "credit-card" ? (
                    <CreditCard className="h-4 w-4" aria-hidden="true" />
                  ) : method.id === "pix" ? (
                    <PixIcon className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Barcode className="h-4 w-4" aria-hidden="true" />
                  )}
                  {method.label}
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-slate-200">
              {activeMethod === "credit-card" ? (
                <div className="divide-y divide-slate-200" aria-label="Parcelas sem juros">
                  {payment.installmentOptions.map((option) => (
                    <div
                      key={option.installments}
                      className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[70px_1fr_1fr_auto] sm:items-center sm:gap-4 odd:bg-slate-50"
                    >
                      <strong>{option.installments}x</strong>
                      <span>
                        de {currencyFormatter.format(option.installmentValue)}
                      </span>
                      <span>Total {currencyFormatter.format(option.total)}</span>
                      <span className="text-emerald-700">sem juros</span>
                    </div>
                  ))}
                </div>
              ) : activeMethod === "pix" ? (
                <div className="p-5 leading-7 text-foreground">
                  <p>
                    <strong className="text-emerald-700">
                      {currencyFormatter.format(payment.pixPrice)}
                    </strong>{" "}
                    com 10% de desconto no Pix.
                  </p>
                  <p className="mt-2 text-sm">
                    As instruções para pagamento serão apresentadas durante o
                    checkout.
                  </p>
                </div>
              ) : (
                <div className="p-5 leading-7 text-foreground">
                  <p>
                    <strong>{currencyFormatter.format(payment.currentPrice)}</strong>{" "}
                    à vista no boleto bancário.
                  </p>
                  <p className="mt-2 text-sm">
                    A emissão e as instruções de pagamento serão apresentadas
                    durante o checkout.
                  </p>
                </div>
              )}
            </div>
          </div>

          <footer className="flex justify-end border-t border-slate-200 px-5 py-4 sm:px-7">
            <button
              type="button"
              onClick={closeDialog}
              className="min-h-11 rounded-xl bg-primary px-5 font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Fechar
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
