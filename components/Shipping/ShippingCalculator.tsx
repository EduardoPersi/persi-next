"use client";

import { MapPin } from "lucide-react";
import { useId } from "react";
import { useShippingCalculator } from "@/hooks/useShippingCalculator";
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

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-[#ff6a00]" aria-hidden="true" />
        <h2 className="font-bold text-[#0c2d72]">Calcular frete e prazo</h2>
      </div>

      {calculator.status === "ready" && calculator.postcode ? (
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
            <div className="space-y-3" role="status" aria-label="Calculando frete">
              {[1, 2].map((item) => (
                <div
                  key={item}
                  className="h-20 animate-pulse rounded-xl bg-slate-200"
                />
              ))}
            </div>
          ) : (
            <ShippingOptions
              packages={calculator.quote.packages}
              selection={calculator.selection}
              disabled={calculator.isLoading}
              selectable={props.mode === "cart"}
              onSelect={(packageId, rateId) =>
                void calculator.chooseRate(packageId, rateId)
              }
            />
          )}
        </div>
      </div>

      <p
        className={`mt-3 min-h-5 text-sm ${
          calculator.status === "error" || calculator.status === "empty"
            ? "text-red-700"
            : "text-slate-600"
        }`}
        role="status"
        aria-live="polite"
      >
        {calculator.message}
      </p>
    </section>
  );
}
