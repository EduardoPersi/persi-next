import Script from "next/script";
import { getRuntimeSafetyPolicy } from "@/lib/runtime/runtime-safety-policy";

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

// A3.6-D1.6 Section 21: defense in depth beyond "just leave the env var
// blank" (D1.5's original recommendation) -- even if NEXT_PUBLIC_GTM_ID is
// accidentally inherited by a staging deploy (e.g. copied wholesale from
// production's real env), this runtime check still prevents the container
// from loading. Production behavior is unchanged (allowProductionAnalytics
// is true there, same as today's unconditional load).
function analyticsAllowed(): boolean {
  return getRuntimeSafetyPolicy().allowProductionAnalytics;
}

export function GoogleTagManagerScript() {
  if (!GTM_ID || !analyticsAllowed()) return null;

  return (
    <Script id="gtm-consent-init" strategy="lazyOnload">
      {`
        window.dataLayer = window.dataLayer || [];
        function gtag(){window.dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('consent', 'default', {
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
          analytics_storage: 'denied',
          wait_for_update: 500
        });
        (function(w,d,s,l,i){
          w[l]=w[l]||[];w[l].push({'gtm.start': new Date().getTime(), event:'gtm.js'});
          var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
          j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
          f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${GTM_ID}');
      `}
    </Script>
  );
}

export function GoogleTagManagerNoScript() {
  if (!GTM_ID || !analyticsAllowed()) return null;

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
