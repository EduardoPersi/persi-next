import {
  metadata,
  ProductListingPage,
} from "@/app/_storefront/search-page";

type RawSearchParams = Record<string, string | string[] | undefined>;

interface SearchPageProps {
  searchParams: Promise<RawSearchParams>;
}

export { metadata };

export default function SearchPage({ searchParams }: SearchPageProps) {
  return ProductListingPage({ searchParams });
}
