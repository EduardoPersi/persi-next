"use client";

import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/UI/Button";
import { useCart } from "@/hooks/useCart";
import { isAddressComplete } from "@/lib/commerce/checkout";
import {
  hasSelectedShippingRate,
  isCheckoutCustomerSynced,
  mapCheckoutFormToWooAddress,
} from "@/lib/commerce/checkoutAddress";
import { formatStoreMoney, isZeroMoney } from "@/lib/formatting/money";
import type { CheckoutFormValues, ShippingStatus } from "@/types/checkout";

const billingFields = [
  "contact.email",
  "contact.firstName",
  "contact.lastName",
  "contact.phone",
  "billingAddress.postalCode",
  "billingAddress.addressLine1",
  "billingAddress.number",
  "billingAddress.neighborhood",
  "billingAddress.city",
  "billingAddress.state",
  "billingAddress.recipientName",
] as const;

const shippingFields = [
  "shippingAddress.postalCode",
  "shippingAddress.addressLine1",
  "shippingAddress.number",
  "shippingAddress.neighborhood",
  "shippingAddress.city",
  "shippingAddress.state",
  "shippingAddress.recipientName",
] as const;

export function CheckoutShippingPlaceholder() {
  const { cart, isCheckoutUpdating, selectShippingRate, updateCustomerAddress } =
    useCart();
  const { control, getValues, reset, trigger } =
    useFormContext<CheckoutFormValues>();
  const shipToBillingAddress = useWatch({
    control,
    name: "shipToBillingAddress",
  });
  const billingAddress = useWatch({ control, name: "billingAddress" });
  const shippingAddress = useWatch({ control, name: "shippingAddress" });
  const contact = useWatch({ control, name: "contact" });
  const activeAddress = shipToBillingAddress
    ? billingAddress
    : shippingAddress;
  const addressComplete = isAddressComplete(activeAddress);
  // `reset()` (chamado no fim de updateAddress) troca a referência de
  // activeAddress mesmo devolvendo os mesmos valores — usar o objeto direto
  // como dependência do efeito abaixo fazia esse próprio reset disparar o
  // cálculo de novo, sem parar. Uma chave por conteúdo resolve isso: só
  // muda quando os valores realmente mudam.
  const addressKey = JSON.stringify({
    contact,
    billingAddress,
    shippingAddress,
    shipToBillingAddress,
  });
  const customerSynced = cart
    ? isCheckoutCustomerSynced(
        getValues(),
        cart.billingAddress,
        cart.shippingAddress,
      )
    : false;
  const selectedShippingRateValid = hasSelectedShippingRate(
    cart?.shippingPackages ?? [],
  );
  const [status, setStatus] = useState<ShippingStatus>(
    hasSelectedShippingRate(cart?.shippingPackages ?? [])
      ? "ready"
      : "idle",
  );
  const [message, setMessage] = useState("");
  const addressRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      addressRequest.current?.abort();
    },
    [],
  );

  const updateAddress = async () => {
    setStatus("validating");
    setMessage("");
    const fields = shipToBillingAddress
      ? [...billingFields]
      : [...billingFields, ...shippingFields];
    const valid = await trigger(fields, { shouldFocus: true });
    if (!valid) {
      setStatus("idle");
      setMessage("Confira os dados do endereço para calcular a entrega.");
      return;
    }

    addressRequest.current?.abort();
    const controller = new AbortController();
    addressRequest.current = controller;
    setStatus("updating-address");
    if (process.env.NODE_ENV === "development") {
      console.info("[checkout] Iniciando atualização do endereço.");
    }
    const result = await updateCustomerAddress(
      mapCheckoutFormToWooAddress(getValues()),
      controller.signal,
    );
    if (result.aborted) return;
    if (!result.success || !result.cart) {
      setStatus("error");
      setMessage(result.message);
      if (process.env.NODE_ENV === "development") {
        console.info("[checkout] Falha HTTP ao atualizar o endereço.");
      }
      return;
    }
    const packages = result.cart.shippingPackages;
    const rateCount = packages.reduce(
      (total, shippingPackage) => total + shippingPackage.rates.length,
      0,
    );
    if (process.env.NODE_ENV === "development") {
      console.info(
        `[checkout] Endereço atualizado: ${packages.length} pacote(s), ${rateCount} taxa(s).`,
      );
    }
    if (!rateCount) {
      setStatus("unavailable");
      setMessage("Não encontramos uma opção de entrega para este endereço.");
      return;
    }
    // O WooCommerce nem sempre mantém uma tarifa selecionada ao recalcular o
    // pacote para o novo endereço (ex.: cliente logado cuja sessão já tinha
    // um endereço anterior associado) — sem isto, "Avançar" ficava travado
    // indefinidamente até o cliente reeditar o CEP na esperança de que o
    // próximo cálculo viesse com uma tarifa selecionada. Seleciona a
    // primeira tarifa do primeiro pacote como padrão para nunca deixar o
    // cliente sem opção nenhuma marcada.
    if (!hasSelectedShippingRate(packages)) {
      const [firstPackage] = packages;
      const [firstRate] = firstPackage?.rates ?? [];
      if (firstPackage && firstRate) {
        const selectResult = await selectShippingRate(
          firstPackage.packageId,
          firstRate.rateId,
        );
        if (!selectResult.success) {
          setStatus("error");
          setMessage(selectResult.message);
          return;
        }
      }
    }
    reset(getValues(), {
      keepErrors: true,
      keepIsSubmitted: true,
      keepTouched: true,
    });
    setStatus("ready");
    setMessage("Opções de entrega atualizadas.");
  };

  // Calcula a entrega sozinho assim que o endereço fica completo (CEP já
  // preenche rua/bairro/cidade/UF automaticamente — só falta número e
  // destinatário) e recalcula de novo se o cliente editar algo depois. O
  // debounce evita disparar uma chamada a cada tecla digitada no número.
  useEffect(() => {
    if (!addressComplete) return;
    if (customerSynced && selectedShippingRateValid) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void updateAddress();
    }, 600);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressComplete, addressKey, customerSynced, selectedShippingRateValid]);

  const chooseRate = async (packageId: number | string, rateId: string) => {
    if (isCheckoutUpdating || status === "selecting-rate") return;
    setStatus("selecting-rate");
    setMessage("");
    if (process.env.NODE_ENV === "development") {
      console.info("[checkout] Selecionando taxa de entrega.");
    }
    const result = await selectShippingRate(packageId, rateId);
    if (!result.success) {
      setStatus("error");
      setMessage(result.message);
      return;
    }
    setStatus("ready");
    setMessage("Opção de entrega atualizada.");
  };

  const packages = cart?.shippingPackages ?? [];
  const availableRateCount = packages.reduce(
    (total, shippingPackage) => total + shippingPackage.rates.length,
    0,
  );
  const effectiveStatus =
    availableRateCount > 0 ? "ready" : status;
  const isBusy =
    isCheckoutUpdating ||
    effectiveStatus === "validating" ||
    effectiveStatus === "updating-address" ||
    effectiveStatus === "loading-rates" ||
    effectiveStatus === "selecting-rate";

  return (
    <div className="border-t border-slate-200 pt-5">
      <h3 className="mb-3 text-xs font-bold text-foreground">Entrega</h3>
      <div aria-live="polite" className="min-h-6 text-xs text-muted">
        {isBusy
          ? "Calculando opções de entrega…"
          : availableRateCount > 0
            ? "Opções de entrega atualizadas."
            : !addressComplete
              ? "Informe seu endereço para calcular a entrega."
              : message}
      </div>

      {effectiveStatus === "ready" && packages.length > 0 ? (
        <div className="mt-4 space-y-5">
          {packages.map((shippingPackage, packageIndex) => (
            <fieldset
              key={String(shippingPackage.packageId)}
              disabled={isBusy}
              className="min-w-0"
            >
              <legend className="mb-3 text-sm font-semibold text-foreground">
                {packages.length > 1
                  ? shippingPackage.name || `Entrega ${packageIndex + 1}`
                  : "Opções disponíveis"}
              </legend>
              <div className="space-y-3">
                {shippingPackage.rates.map((rate) => {
                  const descriptionId = `shipping-${shippingPackage.packageId}-${rate.rateId}-description`;
                  return (
                    <label
                      key={rate.rateId}
                      className="flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 transition has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <input
                        type="radio"
                        name={`shipping-package-${shippingPackage.packageId}`}
                        value={rate.rateId}
                        checked={rate.selected}
                        onChange={() =>
                          void chooseRate(
                            shippingPackage.packageId,
                            rate.rateId,
                          )
                        }
                        aria-describedby={
                          rate.description ||
                          rate.deliveryTime ||
                          rate.methodId === "local_pickup"
                            ? descriptionId
                            : undefined
                        }
                        className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                          <strong className="text-xs text-foreground">
                            {rate.name}
                          </strong>
                          <strong className="text-xs text-foreground">
                            {isZeroMoney(rate.price)
                              ? "Grátis"
                              : formatStoreMoney(rate.price)}
                          </strong>
                        </span>
                        {rate.description ||
                        rate.deliveryTime ||
                        rate.methodId === "local_pickup" ? (
                          <span
                            id={descriptionId}
                            className="mt-1 block text-xs leading-5 text-muted"
                          >
                            {rate.deliveryTime || rate.description}
                            {rate.methodId === "local_pickup" &&
                            !rate.deliveryTime &&
                            !rate.description
                              ? "Retirada na loja após confirmação do pedido."
                              : null}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      {effectiveStatus === "error" || effectiveStatus === "unavailable" ? (
        <Button
          type="button"
          variant="outline"
          disabled={!addressComplete || isBusy}
          onClick={() => void updateAddress()}
          className="mt-5 w-full sm:w-auto"
        >
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
