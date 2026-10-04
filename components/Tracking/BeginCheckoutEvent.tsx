"use client";

import { useEffect, useRef } from "react";
import {
  montarBeginCheckout,
  montarItem,
  registrarBeginCheckout,
} from "@/lib/analytics/eventos";
import type { Cart } from "@/types/cart";

/**
 * Dispara `begin_checkout` UMA vez por visita à tela de checkout, quando o
 * carrinho já está carregado. Não renderiza nada.
 *
 * O `useRef` impede o disparo duplo do modo estrito do React em
 * desenvolvimento; o componente só é montado enquanto o pedido ainda não foi
 * criado, então a tela de Pix/boleto não reenvia o evento.
 */
export function BeginCheckoutEvent({ cart }: { cart: Cart }) {
  const enviado = useRef(false);

  useEffect(() => {
    if (enviado.current || cart.items.length === 0) return;
    enviado.current = true;
    registrarBeginCheckout(
      montarBeginCheckout({
        value: cart.subtotal,
        items: cart.items.map((item) =>
          montarItem({
            sku: item.sku,
            productId: item.productId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          }),
        ),
      }),
    );
    // Só o primeiro carrinho carregado conta; mudanças de quantidade na tela
    // não são um novo "início de checkout".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
