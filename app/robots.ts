import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/routing/storefrontUrls";
import { getRuntimeSafetyPolicy } from "@/lib/runtime/runtime-safety-policy";

export default function robots(): MetadataRoute.Robots {
  // A3.6-D1.6 Section 19: staging must never be crawlable. robots.txt alone
  // is not access control, but it is one required layer -- disallow
  // everything, and never advertise a sitemap, when public indexing is not
  // allowed for this runtime. Production behavior below is byte-for-byte
  // what it already was.
  if (!getRuntimeSafetyPolicy().allowPublicIndexing) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

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
