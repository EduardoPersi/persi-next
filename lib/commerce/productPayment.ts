const PIX_DISCOUNT_RATE = 0.1;
const MAX_INSTALLMENTS = 10;
const MIN_INSTALLMENT_VALUE = 25;

export interface ProductPaymentInfo {
  currentPrice: number;
  pixPrice: number;
  installments: number;
  installmentValue: number;
  installmentOptions: ProductInstallmentOption[];
  isVariable: boolean;
}

export interface ProductInstallmentOption {
  installments: number;
  installmentValue: number;
  total: number;
}

interface GetProductPaymentInfoOptions {
  currentPrice: number;
  isVariable?: boolean;
}

export function getProductPaymentInfo({
  currentPrice,
  isVariable = false,
}: GetProductPaymentInfoOptions): ProductPaymentInfo {
  const normalizedPrice =
    Number.isFinite(currentPrice) && currentPrice >= 0 ? currentPrice : 0;
  const installments = Math.max(
    1,
    Math.min(
      MAX_INSTALLMENTS,
      Math.floor(normalizedPrice / MIN_INSTALLMENT_VALUE),
    ),
  );
  const installmentOptions = Array.from(
    { length: installments },
    (_, index): ProductInstallmentOption => ({
      installments: index + 1,
      installmentValue: normalizedPrice / (index + 1),
      total: normalizedPrice,
    }),
  );

  return {
    currentPrice: normalizedPrice,
    pixPrice: normalizedPrice * (1 - PIX_DISCOUNT_RATE),
    installments,
    installmentValue: normalizedPrice / installments,
    installmentOptions,
    isVariable,
  };
}
