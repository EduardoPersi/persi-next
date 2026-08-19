declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function pushToDataLayer(event: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(event);
}

// Limpa o objeto "ecommerce" anterior antes de cada evento de e-commerce —
// recomendação do Google para evitar que campos de um evento "vazem" por
// merge para o próximo (ex.: items de um add_to_cart aparecendo num
// view_item seguinte). Vale para qualquer evento de e-commerce, não só
// purchase.
export function pushEcommerceEvent(
  event: string,
  ecommerce: Record<string, unknown>,
): void {
  pushToDataLayer({ ecommerce: null });
  pushToDataLayer({ event, ecommerce });
}
