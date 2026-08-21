import "server-only";

export type CheckoutMode = "next" | "hybrid";

export interface PublicCheckoutCapabilities {
  pix: boolean;
  boleto: boolean;
  card: boolean;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1";
}

export function getCheckoutMode(): CheckoutMode {
	return process.env.CHECKOUT_MODE?.trim().toLowerCase() === "hybrid"
		? "hybrid"
		: "next";
}

export function getPublicCheckoutCapabilities(): PublicCheckoutCapabilities {
  return {
    pix: readBoolean("CHECKOUT_PIX_ENABLED", true),
    boleto: readBoolean("CHECKOUT_BOLETO_ENABLED", true),
    // Bloqueio de fase: manter o código PagBank disponível para homologação,
    // mas nenhuma configuração acidental pode ativá-lo em produção agora.
    card: false,
  };
}
