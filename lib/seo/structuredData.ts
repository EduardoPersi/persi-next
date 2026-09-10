import { getProductHref, SITE_URL } from "@/lib/routing/storefrontUrls";
import { STORE_INFO } from "@/lib/constants/storeInfo";

interface CollectionPageJsonLdInput {
  name: string;
  description?: string;
  url: string;
  image?: string;
  brand?: { name: string };
}

export function buildCollectionPageJsonLd({
  name,
  description,
  url,
  image,
  brand,
}: CollectionPageJsonLdInput) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description: description || undefined,
    url,
    image: image || undefined,
    brand: brand ? { "@type": "Brand", name: brand.name } : undefined,
  };
}

const ITEM_LIST_LIMIT = 20;

interface ItemListProductInput {
  slug: string;
  name: string;
}

const LOGO_PATH =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas cabeçalho.webp";

export function buildLocalBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "HardwareStore",
    name: STORE_INFO.name,
    url: SITE_URL,
    logo: new URL(LOGO_PATH, SITE_URL).toString(),
    image: new URL(LOGO_PATH, SITE_URL).toString(),
    telephone: STORE_INFO.phone.label,
    email: STORE_INFO.email.label,
    address: {
      "@type": "PostalAddress",
      streetAddress: "Rua Itirapina, 163, Vila Lacerda",
      addressLocality: "Jundiaí",
      addressRegion: "SP",
      postalCode: STORE_INFO.address.postcode,
      addressCountry: "BR",
    },
    sameAs: [
      "https://www.instagram.com/persimateriais/",
      "https://www.facebook.com/pemaconbr/",
      "https://www.youtube.com/@persimateriais",
      "https://www.tiktok.com/@persimateriais/",
    ],
  };
}

export function buildWebSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: STORE_INFO.name,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/busca?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function buildProductItemListJsonLd(
  products: readonly ItemListProductInput[],
  siteUrl: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.slice(0, ITEM_LIST_LIMIT).map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: new URL(getProductHref(product.slug), siteUrl).toString(),
      name: product.name,
    })),
  };
}
