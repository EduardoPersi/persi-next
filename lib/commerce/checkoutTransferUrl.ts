const CHECKOUT_HOST = "loja.persimateriais.com.br";
const TRANSFER_PARAMETER = "persi_checkout_transfer";

export function validateCheckoutTransferUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const url = new URL(value);
    const belongsToCheckoutHost = url.hostname === CHECKOUT_HOST;
    const token = url.searchParams.get(TRANSFER_PARAMETER);

    if (
      url.protocol !== "https:" ||
      !belongsToCheckoutHost ||
      url.username ||
      url.password ||
      !token ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
