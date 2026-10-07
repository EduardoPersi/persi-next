import type { CartMoney, CheckoutShippingRate } from "../../types/cart.ts";

function moneyToNumber(money: CartMoney): number {
  if (!/^-?\d+$/.test(money.value)) return Number.POSITIVE_INFINITY;
  return Number(money.value) / 10 ** Math.max(0, money.currencyMinorUnit);
}

function isPickup(rate: CheckoutShippingRate): boolean {
  return rate.methodId === "local_pickup";
}

// Do frete mais barato para o mais caro. A ordenação é estável: empates
// mantêm a ordem em que o WooCommerce devolveu as tarifas.
export function sortShippingRatesByPrice(
  rates: readonly CheckoutShippingRate[],
): CheckoutShippingRate[] {
  return rates
    .map((rate, index) => ({ rate, index }))
    .sort(
      (a, b) =>
        moneyToNumber(a.rate.price) - moneyToNumber(b.rate.price) ||
        a.index - b.index,
    )
    .map(({ rate }) => rate);
}

// Tarifa marcada por padrão quando o WooCommerce não deixa nenhuma
// selecionada: a mais barata entre as entregas. A retirada na loja só é
// escolhida por padrão se for a única opção, para o cliente não receber um
// pedido "para retirar" sem ter pedido isso.
export function pickDefaultShippingRate(
  rates: readonly CheckoutShippingRate[],
): CheckoutShippingRate | undefined {
  const sorted = sortShippingRatesByPrice(rates);
  return sorted.find((rate) => !isPickup(rate)) ?? sorted[0];
}
