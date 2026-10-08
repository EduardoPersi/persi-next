import type { AddCartItemInput, Cart } from "../../types/cart.ts";
import {
  planejarRecuperacao,
  type DadosRecuperados,
  type ItemRecuperado,
} from "./recuperar.ts";

/**
 * Recria o carrinho a partir do que o CRM devolveu, SÓ com itens em estoque e
 * a preço de agora (o preço vem do WooCommerce, nunca do CRM). As chamadas ao
 * WooCommerce entram por `deps`, então a lógica é testável sem rede.
 *
 * Carrinho vazio: recria. Carrinho com itens: junta sem duplicar, ficando com
 * a MAIOR quantidade de cada item.
 */

export interface RespostaDoCarrinho {
  cart: Cart;
  cartToken?: string;
}

export interface DependenciasDoCarrinho {
  getCart(cartToken?: string): Promise<RespostaDoCarrinho>;
  addItem(input: AddCartItemInput, cartToken?: string): Promise<RespostaDoCarrinho>;
  updateItem(key: string, quantity: number, cartToken: string): Promise<RespostaDoCarrinho>;
  applyCoupon(code: string, cartToken: string): Promise<RespostaDoCarrinho>;
}

export interface ResultadoDaRecuperacao {
  cart: Cart;
  cartToken: string;
  /** Quantos itens entraram ou aumentaram de quantidade. */
  restaurados: number;
  /** Itens que ficaram de fora (sem estoque ou indisponíveis). */
  ausentes: number;
  /** Itens que entraram com menos do que antes, por causa do estoque. */
  ajustados: number;
}

async function tentar<T>(operacao: () => Promise<T>): Promise<T | null> {
  try {
    return await operacao();
  } catch {
    return null;
  }
}

function entrada(item: ItemRecuperado, quantidade: number): AddCartItemInput {
  return {
    productId: item.id,
    quantity: quantidade,
    ...(item.variacao ? { variation: item.variacao } : {}),
  };
}

export async function recriarCarrinho(
  dados: DadosRecuperados,
  cartTokenAtual: string | undefined,
  deps: DependenciasDoCarrinho,
): Promise<ResultadoDaRecuperacao> {
  let estado = await deps.getCart(cartTokenAtual);
  let cartToken = estado.cartToken ?? cartTokenAtual ?? "";
  const aplicar = (resposta: RespostaDoCarrinho) => {
    estado = resposta;
    cartToken = resposta.cartToken ?? cartToken;
  };

  const passos = planejarRecuperacao(
    estado.cart.items.map((item) => ({ key: item.key, id: item.id, quantity: item.quantity })),
    dados.itens,
  );

  let restaurados = 0;
  let ausentes = 0;
  let ajustados = 0;

  for (const passo of passos) {
    if (passo.tipo === "adicionar") {
      const completo = await tentar(() => deps.addItem(entrada(passo.item, passo.item.quantidade), cartToken));
      if (completo) {
        aplicar(completo);
        restaurados += 1;
        continue;
      }
      // Quantidade acima do estoque: entra com 1 e sobe até o que o WooCommerce permitir.
      const minimo = await tentar(() => deps.addItem(entrada(passo.item, 1), cartToken));
      if (!minimo) {
        ausentes += 1;
        continue;
      }
      aplicar(minimo);
      restaurados += 1;
      const noCarrinho = minimo.cart.items.find((item) => item.id === passo.item.id);
      const limite = Math.min(passo.item.quantidade, noCarrinho?.maxQuantity ?? 1);
      if (noCarrinho && limite > 1) {
        const subiu = await tentar(() => deps.updateItem(noCarrinho.key, limite, cartToken));
        if (subiu) aplicar(subiu);
      }
      ajustados += 1;
    } else {
      const subiu = await tentar(() => deps.updateItem(passo.key, passo.para, cartToken));
      if (subiu) {
        aplicar(subiu);
        restaurados += 1;
        continue;
      }
      const atual = estado.cart.items.find((item) => item.key === passo.key);
      const limite = Math.min(passo.para, atual?.maxQuantity ?? passo.de);
      if (atual && limite > passo.de) {
        const parcial = await tentar(() => deps.updateItem(passo.key, limite, cartToken));
        if (parcial) {
          aplicar(parcial);
          restaurados += 1;
          ajustados += 1;
        }
      }
    }
  }

  if (dados.cupom && cartToken) {
    const comCupom = await tentar(() => deps.applyCoupon(dados.cupom as string, cartToken));
    if (comCupom) aplicar(comCupom);
  }

  return { cart: estado.cart, cartToken, restaurados, ausentes, ajustados };
}
