"use client";

import { useEffect, useRef } from "react";
import {
  montarPurchase,
  registrarPurchase,
  type ItemDeEvento,
} from "@/lib/analytics/eventos";

interface PurchaseEventProps {
  transactionId: number | string;
  value: number | string;
  shipping?: number | string;
  items: ItemDeEvento[];
}

const PREFIXO_DA_CHAVE = "persi_purchase_";

/**
 * Dispara `purchase` UMA vez por pedido pago. Não renderiza nada.
 *
 * A confirmação pode ser aberta de novo (atualizar a página, voltar pelo
 * histórico, link do e-mail): sem trava, cada visita contaria a mesma receita
 * outra vez no GA4. A trava é o `transaction_id` guardado no navegador
 * (`localStorage`); se o armazenamento estiver bloqueado, vale só a trava da
 * montagem (uma vez por carga de página) — melhor isso do que perder a venda.
 * O GA4 também deduplica `transaction_id` repetido, como segunda rede.
 */
export function PurchaseEvent({ transactionId, value, shipping, items }: PurchaseEventProps) {
  const enviado = useRef(false);

  useEffect(() => {
    if (enviado.current) return;
    enviado.current = true;

    const chave = `${PREFIXO_DA_CHAVE}${transactionId}`;
    try {
      if (window.localStorage.getItem(chave)) return;
      window.localStorage.setItem(chave, new Date().toISOString());
    } catch {
      // Sem armazenamento: segue com a trava em memória.
    }
    registrarPurchase(montarPurchase({ transactionId, value, shipping, items }));
    // Os dados do pedido não mudam depois de pago; roda só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
