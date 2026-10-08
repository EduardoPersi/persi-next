/**
 * Opt-in de WhatsApp e `sessao` do pedido (metadados, nada mais).
 *
 * A caixa "Quero receber atualizações do pedido e lembretes do meu carrinho
 * pelo WhatsApp" do checkout vai para o pedido como `_persi_optin_whatsapp`
 * ("1" marcado, "0" desmarcado), junto com a `sessao` (o hash do token do
 * carrinho, o mesmo do `cart.updated`) em `_persi_sessao`. Só metadado: não
 * mexe em valor, total, gateway nem cobrança.
 *
 * Decisão do Eduardo (08/10/2026): quem desmarcou NÃO recebe nenhuma mensagem
 * de WhatsApp do site (cobrança, andamento, recuperação de carrinho). E-mails
 * seguem normais. Pedido antigo, sem o metadado, conta como marcado.
 *
 * Arquivo sem dependências, de propósito: serviços e avisos importam daqui.
 */

export const SESSAO_META = "_persi_sessao";
export const OPTIN_WHATSAPP_META = "_persi_optin_whatsapp";

/** Os metadados do pedido que um aviso precisa conhecer. */
export type MetaDoPedido = Record<string, string> | undefined;

/** Sem o metadado (pedido antigo) ou com qualquer valor que não seja "0": quer receber. */
export function optinWhatsappDoPedido(meta: MetaDoPedido): boolean {
  return meta?.[OPTIN_WHATSAPP_META] !== "0";
}

/** A `sessao` gravada no pedido, se for um hash válido (64 hexadecimais). */
export function sessaoDoPedido(meta: MetaDoPedido): string | undefined {
  const sessao = meta?.[SESSAO_META];
  return sessao && /^[0-9a-f]{64}$/.test(sessao) ? sessao : undefined;
}

/** O valor que vai para o metadado do pedido. */
export function optinParaMeta(optin: boolean): "1" | "0" {
  return optin ? "1" : "0";
}
