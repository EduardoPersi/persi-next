import { validateCheckoutTransferUrl } from "./checkoutTransferUrl.ts";

const CHECKOUT_ERROR_MESSAGE =
  "Não foi possível preparar o checkout. Tente novamente.";

export class CheckoutTransferRequestGate {
  private active = false;

  tryStart(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  finish(): void {
    this.active = false;
  }
}

export async function requestCheckoutTransfer(
  fetchImplementation: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImplementation("/api/checkout-transfer", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => null)) as
    | { transferUrl?: unknown }
    | null;
  const transferUrl = validateCheckoutTransferUrl(body?.transferUrl);

  if (!response.ok || !transferUrl) {
    throw new Error(CHECKOUT_ERROR_MESSAGE);
  }

  return transferUrl;
}
