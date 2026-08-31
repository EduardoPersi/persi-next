import { formatStoreMoney, isZeroMoney } from "@/lib/formatting/money";
import type { CheckoutShippingRate } from "@/types/cart";

function formatDeliveryTime(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return normalized;

  const days = Number(normalized);
  return `${days} ${days === 1 ? "dia útil" : "dias úteis"}`;
}

interface ShippingOptionCardProps {
  checked: boolean;
  disabled: boolean;
  groupName: string;
  onSelect: () => void;
  rate: CheckoutShippingRate;
  selectable?: boolean;
}

export function ShippingOptionCard({
  checked,
  disabled,
  groupName,
  onSelect,
  rate,
  selectable = true,
}: ShippingOptionCardProps) {
  const descriptionId = `${groupName}-${rate.rateId.replace(/[^a-z0-9_-]/gi, "-")}-description`;
  const detail =
    formatDeliveryTime(rate.deliveryTime) ||
    rate.description ||
    (rate.methodId === "local_pickup"
      ? "Retirada na loja após confirmação."
      : "");

  const content = (
    <>
      {selectable ? (
      <input
        type="radio"
        name={groupName}
        value={rate.rateId}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-describedby={detail ? descriptionId : undefined}
        className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
      />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <strong className="text-sm text-foreground">{rate.name}</strong>
          <strong className="text-sm text-foreground">
            {isZeroMoney(rate.price)
              ? "Grátis"
              : formatStoreMoney(rate.price)}
          </strong>
        </span>
        {detail ? (
          <span
            id={descriptionId}
            className="mt-1 block text-sm leading-5 text-muted"
          >
            {detail}
          </span>
        ) : null}
      </span>
    </>
  );

  return selectable ? (
    <label className="flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition duration-200 has-[:checked]:border-primary has-[:checked]:bg-blue-50/60">
      {content}
    </label>
  ) : (
    <div
      role="listitem"
      className="flex min-h-16 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      {content}
    </div>
  );
}
