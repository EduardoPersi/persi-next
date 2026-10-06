import Script from "next/script";
import { IDS_DE_ANALYTICS } from "@/lib/analytics/config";

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

// IDs opcionais (GA4 e Pixel) oferecidos ao GTM como variáveis do dataLayer.
// Vazio quando nenhum está configurado — aí nada é empurrado. O JSON vem de
// valores já validados por formato (lib/analytics/config.ts).
const IDS_JSON = JSON.stringify(IDS_DE_ANALYTICS).replace(/</g, "\\u003c");
const IDS_PUSH =
  Object.keys(IDS_DE_ANALYTICS).length > 0
    ? `window.dataLayer.push(${IDS_JSON});`
    : "";

export function GoogleTagManagerScript() {
  if (!GTM_ID) return null;

  return (
    <Script id="gtm-consent-init" strategy="lazyOnload">
      {`
        window.dataLayer = window.dataLayer || [];
        var pendingEvents = window.dataLayer.splice(0);
        function gtag(){window.dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('consent', 'default', {
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
          analytics_storage: 'denied',
          wait_for_update: 500
        });
        ${IDS_PUSH}
        (function(w,d,s,l,i){
          // Inicialização precede os eventos React enfileirados antes do
          // lazyOnload, preservando o consentimento padrão como primeiro item.
          w[l]=w[l]||[];w[l].push({'gtm.start': new Date().getTime(), event:'gtm.js'});
          var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
          j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
          f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${GTM_ID}');
        pendingEvents.forEach(function(event){window.dataLayer.push(event);});
      `}
    </Script>
  );
}

export function GoogleTagManagerNoScript() {
  if (!GTM_ID) return null;

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
