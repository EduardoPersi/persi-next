import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { CartProvider } from "@/components/Cart/CartProvider";
import { GoogleOneTap } from "@/components/Account/GoogleOneTap";
import { Footer } from "@/components/Footer/Footer";
import { FooterVisibility } from "@/components/Footer/FooterVisibility";
import { BackToTopButton } from "@/components/UI/BackToTopButton";
import { WhatsAppFloatingButton } from "@/components/UI/WhatsAppFloatingButton";
import { CookieConsentBanner } from "@/components/UI/CookieConsentBanner";
import {
  GoogleTagManagerNoScript,
  GoogleTagManagerScript,
} from "@/components/layout/GoogleTagManager";
import { AnalyticsPageView } from "@/components/layout/AnalyticsPageView";
import { OverlayManagerProvider } from "@/context/OverlayManager";
import { RouteTransitionProvider } from "@/context/RouteTransition";
import { RouteTransitionOverlay } from "@/components/UI/RouteTransitionOverlay";
import "./globals.css";
import { SITE_URL } from "@/lib/routing/storefrontUrls";
import { AccountProvider } from "@/hooks/useAccount";
import { CookieConsentProvider } from "@/hooks/useCookieConsent";
import { CustomerListsProvider } from "@/lib/customer-lists/provider";
import { NavigationProvider } from "@/components/navigation/NavigationProvider";
import { getMegaMenuData } from "@/services/menu/menu";

const PERSI_HEADER_COLOR = "#002b57";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const SITE_NAME = "Persi Materiais";
const DEFAULT_TITLE = "Persi Materiais elétricos e hidráulicos";
const DEFAULT_DESCRIPTION =
  "Materiais de construção, elétrica, hidráulica, ferramentas e EPIs em Jundiaí, com entrega para Jundiaí, Itupeva, Várzea Paulista e região.";
const DEFAULT_OG_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas cabeçalho.webp";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: DEFAULT_TITLE,
  },
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    locale: "pt_BR",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [{ url: DEFAULT_OG_IMAGE, alt: DEFAULT_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: PERSI_HEADER_COLOR,
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const megaMenu = await getMegaMenuData();

  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-white focus:px-4 focus:py-3 focus:text-primary focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          Pular para o conteúdo
        </a>
        <GoogleTagManagerScript />
        <GoogleTagManagerNoScript />
        <AnalyticsPageView />
        <RouteTransitionProvider>
          <CookieConsentProvider>
            <NavigationProvider menu={megaMenu}>
              <OverlayManagerProvider>
                <AccountProvider>
                  <CustomerListsProvider>
                    <CartProvider>
                      <RouteTransitionOverlay>{children}</RouteTransitionOverlay>
                      <FooterVisibility>
                        <Footer />
                      </FooterVisibility>
                      <BackToTopButton />
                      <WhatsAppFloatingButton />
                      <GoogleOneTap />
                      <CookieConsentBanner />
                    </CartProvider>
                  </CustomerListsProvider>
                </AccountProvider>
              </OverlayManagerProvider>
            </NavigationProvider>
          </CookieConsentProvider>
        </RouteTransitionProvider>
      </body>
    </html>
  );
}
