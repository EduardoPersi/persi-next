import type { CheckoutShippingPackage } from "@/types/cart";
import type { ShippingSelection } from "@/types/shipping";
import { ShippingOptionCard } from "./ShippingOptionCard";

interface ShippingOptionsProps {
  disabled: boolean;
  onSelect: (packageId: number | string, rateId: string) => void;
  packages: CheckoutShippingPackage[];
  selection?: ShippingSelection;
  selectable?: boolean;
}

export function ShippingOptions({
  disabled,
  onSelect,
  packages,
  selection,
  selectable = true,
}: ShippingOptionsProps) {
  return (
    <div className="space-y-5">
      {packages.map((shippingPackage, packageIndex) => (
        <fieldset
          key={String(shippingPackage.packageId)}
          disabled={disabled}
          className="min-w-0"
        >
          <legend className="mb-3 text-sm font-semibold text-foreground">
            {packages.length > 1
              ? shippingPackage.name || `Entrega ${packageIndex + 1}`
              : "Opções disponíveis"}
          </legend>
          <div className="space-y-3">
            {shippingPackage.rates.map((rate) => (
              <ShippingOptionCard
                key={rate.rateId}
                rate={rate}
                groupName={`shipping-${shippingPackage.packageId}`}
                checked={
                  selection?.packageId === shippingPackage.packageId &&
                  selection.rateId === rate.rateId
                }
                disabled={disabled}
                selectable={selectable}
                onSelect={() =>
                  onSelect(shippingPackage.packageId, rate.rateId)
                }
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
