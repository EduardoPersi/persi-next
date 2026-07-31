import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/routing/storefrontUrls";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/busca",
        "/carrinho",
        "/checkout",
        "/minha-conta",
        "/entrar",
        "/criar-conta",
      ],
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
    host: SITE_URL,
  };
}
