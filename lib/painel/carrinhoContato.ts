/**
 * Contato do carrinho que o site conta ao painel (`cart.updated`). Código puro,
 * sem acesso ao navegador nem ao servidor: o checkout usa para decidir QUANDO
 * avisar e a rota usa para conferir de novo, sem confiar no navegador.
 *
 * Contrato: docs/contrato-carrinho-crm.md.
 */

const TAMANHO_MAXIMO_NOME = 200;
const TAMANHO_MAXIMO_EMAIL = 254;

export function emailDoCarrinho(valor: string | undefined | null): string | null {
  const email = (valor ?? "").trim().toLowerCase();
  if (!email || email.length > TAMANHO_MAXIMO_EMAIL) return null;
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? email : null;
}

/**
 * WhatsApp só com dígitos e DDI 55 (`5511987654321`). Aceita com ou sem 55 e
 * com máscara; só vale DDD + 8 ou 9 dígitos (10 ou 11 no total).
 */
export function whatsappDoCarrinho(valor: string | undefined | null): string | null {
  let digitos = (valor ?? "").replace(/\D/g, "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
    digitos = digitos.slice(2);
  }
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  return `55${digitos}`;
}

export function nomeDoCarrinho(valor: string | undefined | null): string | undefined {
  const nome = (valor ?? "").replace(/\s+/g, " ").trim().slice(0, TAMANHO_MAXIMO_NOME);
  return nome || undefined;
}

export function temContatoValido(contato: {
  email?: string | null;
  whatsapp?: string | null;
}): boolean {
  return emailDoCarrinho(contato.email) !== null || whatsappDoCarrinho(contato.whatsapp) !== null;
}

export type EtapaDoCarrinho = "perfil" | "entrega" | "pagamento";

/** Etapas do checkout (`CheckoutStepName`) → nome do contrato. */
export function etapaDoContrato(etapa: "profile" | "address" | "payment"): EtapaDoCarrinho {
  if (etapa === "address") return "entrega";
  if (etapa === "payment") return "pagamento";
  return "perfil";
}
