const PUBLIC_CHECKOUT_HOST = "persimateriais.com.br";
const BACKEND_CHECKOUT_HOST = "loja.persimateriais.com.br";
const PUBLIC_TRANSFER_PATH = "/checkout/transfer";
const PUBLIC_TRANSFER_PARAMETER = "token";
const BACKEND_TRANSFER_PARAMETER = "persi_checkout_transfer";

function validToken(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));
}

export function validateCheckoutTransferUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const url = new URL(value);
    const token = url.searchParams.get(PUBLIC_TRANSFER_PARAMETER);

    if (
      url.protocol !== "https:" ||
      url.hostname !== PUBLIC_CHECKOUT_HOST ||
      url.pathname !== PUBLIC_TRANSFER_PATH ||
      url.username ||
      url.password ||
      !validToken(token) ||
      [...url.searchParams.keys()].some((key) => key !== PUBLIC_TRANSFER_PARAMETER) ||
      url.hash
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function toPublicCheckoutTransferUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const backendUrl = new URL(value);
    const token = backendUrl.searchParams.get(BACKEND_TRANSFER_PARAMETER);
    if (
      backendUrl.protocol !== "https:" ||
      backendUrl.hostname !== BACKEND_CHECKOUT_HOST ||
      backendUrl.pathname !== "/checkout/" ||
      backendUrl.username ||
      backendUrl.password ||
      !validToken(token) ||
      [...backendUrl.searchParams.keys()].some(
        (key) => key !== BACKEND_TRANSFER_PARAMETER,
      ) ||
      backendUrl.hash
    ) {
      return null;
    }

    const publicUrl = new URL(PUBLIC_TRANSFER_PATH, `https://${PUBLIC_CHECKOUT_HOST}`);
    publicUrl.searchParams.set(PUBLIC_TRANSFER_PARAMETER, token);
    return publicUrl.toString();
  } catch {
    return null;
  }
}
