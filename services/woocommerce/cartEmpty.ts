import type { Cart } from "../../types/cart.ts";

/**
 * Esvazia o carrinho do WooCommerce depois que o pedido foi criado.
 *
 * O pedido já nasceu de uma foto do carrinho (getAuthoritativeCheckoutItems); sem
 * esvaziar, os mesmos itens continuam no carrinho depois da compra, como se o
 * pedido não tivesse sido feito. Remove só os ITENS: a sessão do carrinho (o
 * token) fica, porque o token é a prova de que quem consulta o pedido é quem o
 * criou (services/payments/statusAuthorization.ts) e a `sessao` da integração
 * com o CRM sai dele.
 *
 * Nunca lança: o pedido e o pagamento valem mais que a limpeza. Dependências
 * injetadas, para testar sem rede.
 */
export interface EmptyCartDeps {
  getCart(cartToken: string): Promise<{ cart: Cart }>;
  removeItem(key: string, cartToken: string): Promise<unknown>;
}

export interface EmptyCartResult {
  removed: number;
  failed: number;
}

export async function emptyCartItems(
  cartToken: string | undefined,
  deps: EmptyCartDeps,
): Promise<EmptyCartResult> {
  const result: EmptyCartResult = { removed: 0, failed: 0 };
  if (!cartToken) return result;

  let keys: string[];
  try {
    keys = (await deps.getCart(cartToken)).cart.items.map((item) => item.key);
  } catch {
    return { removed: 0, failed: 1 };
  }

  for (const key of keys) {
    try {
      await deps.removeItem(key, cartToken);
      result.removed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
