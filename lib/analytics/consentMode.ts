import type { CookieConsentValue } from "@/lib/consent/cookieConsent";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Atualiza o Consent Mode v2 do Google com a escolha da pessoa.
 *
 * Empurra direto para o `dataLayer`, no formato do `gtag` (o objeto
 * `arguments`, não um array — o GTM só reconhece comandos nesse formato).
 * Antes isto chamava `window.gtag?.(…)`, mas o `gtag` só passa a existir
 * quando o script do GTM carrega (`lazyOnload`); para quem já tinha aceitado
 * em outra visita, o `update` rodava ANTES disso, caía no `?.` vazio e se
 * perdia — a pessoa ficava com tudo "negado" apesar de ter consentido.
 * No `dataLayer` o comando fica na fila e o script de inicialização o aplica
 * depois do `default`, na ordem certa.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- os parâmetros só existem para o objeto `arguments`
function gtagNaFila(..._comando: unknown[]): void {
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params -- o GTM exige o objeto `arguments`, não um array
  window.dataLayer.push(arguments);
}

export function updateGoogleConsent(value: CookieConsentValue): void {
  const state = value === "accepted" ? "granted" : "denied";
  gtagNaFila("consent", "update", {
    ad_storage: state,
    ad_user_data: state,
    ad_personalization: state,
    analytics_storage: state,
  });
}
