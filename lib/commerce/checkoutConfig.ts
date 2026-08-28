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
  const cardEnabled = readBoolean("CHECKOUT_CARD_ENABLED", false);
  const cardEnvironment = process.env.CHECKOUT_CARD_ENVIRONMENT?.trim().toLowerCase();
  // O Mercado Pago não separa sandbox por URL base (mesmo endpoint para os
  // dois ambientes). Aplicações mais antigas distinguiam o ambiente pelo
  // prefixo do access token (`TEST-...` vs `APP_USR-...`), mas aplicações do
  // tipo "Pagamentos online" (a usada neste projeto) emitem credenciais de
  // teste também no formato `APP_USR-...`, vinculadas a um usuário de teste —
  // não há como distinguir sandbox de produção pela forma do token. Por isso
  // confiamos na declaração explícita do operador (`CHECKOUT_CARD_ENVIRONMENT`),
  // sem checagem adicional de prefixo.
  const mercadoPagoAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? "";
  const sandboxConfigured = cardEnvironment === "sandbox" && mercadoPagoAccessToken.length > 0;
  const productionApproved =
    cardEnvironment === "production" &&
    readBoolean("CHECKOUT_CARD_PRODUCTION_APPROVED", false);

  return {
    pix: readBoolean("CHECKOUT_PIX_ENABLED", true),
    boleto: readBoolean("CHECKOUT_BOLETO_ENABLED", true),
    // O código histórico permanece pronto, mas cartão só aparece e só passa
    // pelo backend com habilitação explícita e ambiente coerente. Produção
    // exige uma segunda confirmação independente da flag principal.
    card: cardEnabled && (sandboxConfigured || productionApproved),
  };
}
