import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/routing/storefrontUrls";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/busca",
        "/carrinho",
        "/checkout",
        "/minha-conta",
        "/favoritos",
        "/entrar",
        "/criar-conta",
      ],
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
    host: SITE_URL,
  };
}
