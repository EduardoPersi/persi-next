"use client";

import {
  CircleAlert,
  MapPin,
  MessageCircle,
  Search,
  Store,
  Truck,
  WifiOff,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/UI/Button";
import { useShippingCalculator } from "@/hooks/useShippingCalculator";
import { STORE_INFO } from "@/lib/constants/storeInfo";
import { isZeroMoney } from "@/lib/formatting/money";
import type {
  ProductShippingInput,
  SelectedShippingRate,
} from "@/types/shipping";
import { ShippingOptions } from "./ShippingOptions";
import { ZipCodeInput } from "./ZipCodeInput";

interface ShippingCalculatorProps {
  contextKey: string;
  mode: "cart" | "product";
  onSelectionChange?: (selection?: SelectedShippingRate) => void;
  product?: ProductShippingInput;
}

interface FeedbackCardProps {
  children?: ReactNode;
  icon: ReactNode;
  text: string;
  title: string;
  tone?: "informative" | "danger";
}

function FeedbackCard({
  children,
  icon,
  text,
  title,
  tone = "informative",
}: FeedbackCardProps) {
  const danger = tone === "danger";

  return (
    <div
      className={`rounded-xl border p-4 ${
        danger
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-blue-100 bg-blue-50/70 text-slate-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={danger ? "text-red-700" : "text-[#0c2d72]"}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-current">{title}</h3>
          <p className="mt-1 text-sm leading-6">{text}</p>
          {children ? <div className="mt-4">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ShippingCalculator(props: ShippingCalculatorProps) {
  const inputId = useId();
  const calculator = useShippingCalculator(props);
  const destination = calculator.quote.destination;
  const destinationParts = [
    destination?.address1,
    destination?.address2,
    destination?.city,
    destination?.state,
  ].filter(Boolean);
  const rates = calculator.quote.packages.flatMap(
    (shippingPackage) => shippingPackage.rates,
  );
  const hasFreeShipping = rates.some((rate) => isZeroMoney(rate.price));
  const hasStorePickup = rates.some((rate) => rate.methodId === "local_pickup");

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-[#ff6a00]" aria-hidden="true" />
        <h2 className="font-bold text-[#0c2d72]">Calcular frete e prazo</h2>
      </div>

      {calculator.status === "idle" ? (
        <p className="mt-3 text-sm text-slate-600" aria-live="polite">
          Informe seu CEP para consultar prazo e valor do frete.
        </p>
      ) : null}

      {calculator.status === "success" && calculator.postcode ? (
        <div className="mt-4 rounded-xl bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Entrega para
          </p>
          <p className="mt-1 text-sm text-slate-800">
            {destinationParts.length
              ? destinationParts.join(" — ")
              : `CEP ${calculator.postcode}`}
          </p>
          <button
            type="button"
            onClick={calculator.reset}
            className="mt-2 text-sm font-semibold text-[#ff6a00] underline underline-offset-2"
          >
            Alterar CEP
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <ZipCodeInput
            id={`shipping-postcode-${inputId}`}
            value={calculator.postcode}
            isLoading={calculator.isLoading}
            onChange={calculator.setPostcode}
            onSubmit={() => void calculator.calculate()}
          />
        </div>
      )}

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ${
          calculator.isLoading || calculator.quote.packages.length
            ? "mt-4 grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {calculator.isLoading ? (
            <div
              className="space-y-3"
              role="status"
              aria-label="Calculando opções de entrega"
            >
              <p className="text-sm font-medium text-[#0c2d72]">
                Calculando opções de entrega...
              </p>
              {[1, 2].map((item) => (
                <div
                  key={item}
                  className="h-20 animate-pulse rounded-xl bg-slate-200"
                />
              ))}
            </div>
          ) : (
            <>
              {hasFreeShipping ? (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800">
                  <Truck className="h-5 w-5" aria-hidden="true" />
                  Frete grátis para sua região
                </div>
              ) : null}
              {hasStorePickup ? (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-900">
                  <Store className="h-5 w-5" aria-hidden="true" />
                  Retire em nossa loja
                </div>
              ) : null}
              <ShippingOptions
                packages={calculator.quote.packages}
                selection={calculator.selection}
                disabled={calculator.isLoading}
                selectable={props.mode === "cart"}
                onSelect={(packageId, rateId) =>
                  void calculator.chooseRate(packageId, rateId)
                }
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-3" role="status" aria-live="polite" aria-atomic="true">
        {calculator.status === "success" && calculator.message ? (
          <p className="text-sm text-slate-600">{calculator.message}</p>
        ) : null}

        {calculator.status === "empty" ? (
          <FeedbackCard
            icon={<MapPin className="h-5 w-5" />}
            title="Ainda não entregamos nesse CEP."
            text="No momento não encontramos opções de entrega para esta região. Verifique se o CEP está correto. Caso tenha dúvidas, fale com nossa equipe para consultar uma alternativa."
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button variant="outline" size="sm" onClick={calculator.reset}>
                Alterar CEP
              </Button>
              <a
                href="https://buscacepinter.correios.com.br/app/endereco/index.php?t"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#0c2d72] px-3 py-1.5 text-sm font-medium text-[#0c2d72] transition-colors hover:bg-blue-100"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Pesquisar CEP
              </a>
              <a
                href={STORE_INFO.whatsapp.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-[#ff6a00] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-700"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Falar com um consultor
              </a>
            </div>
          </FeedbackCard>
        ) : null}

        {calculator.status === "invalid_cep" ? (
          <FeedbackCard
            icon={<CircleAlert className="h-5 w-5" />}
            title="CEP inválido."
            text="Confira os números informados."
            tone="danger"
          />
        ) : null}

        {calculator.status === "network_error" ? (
          <FeedbackCard
            icon={<WifiOff className="h-5 w-5" />}
            title="Não foi possível consultar o frete neste momento."
            text="Verifique sua conexão e tente novamente."
          >
            <Button size="sm" onClick={() => void calculator.calculate()}>
              Tentar novamente
            </Button>
          </FeedbackCard>
        ) : null}

        {calculator.status === "server_error" ? (
          <FeedbackCard
            icon={<CircleAlert className="h-5 w-5" />}
            title="Estamos com uma instabilidade temporária no cálculo de frete."
            text="Tente novamente em alguns instantes."
            tone="danger"
          >
            <Button size="sm" onClick={() => void calculator.calculate()}>
              Tentar novamente
            </Button>
          </FeedbackCard>
        ) : null}
      </div>
    </section>
  );
}
