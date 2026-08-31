import type { Metadata } from "next";
import { ProductListingPage } from "@/app/_storefront/search-page";

type RawSearchParams = Record<string, string | string[] | undefined>;

interface StorePageProps {
  searchParams: Promise<RawSearchParams>;
}

export const metadata: Metadata = {
  title: "Loja | Persi Materiais",
  description:
    "Encontre materiais elétricos, hidráulicos, ferramentas e produtos para sua obra na loja da Persi Materiais.",
  alternates: { canonical: "/loja" },
};

export default function StorePage({ searchParams }: StorePageProps) {
  return ProductListingPage({ searchParams, catalogMode: true });
}
