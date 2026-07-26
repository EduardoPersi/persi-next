export interface ProductFamilyAttributeValue {
  slug: string;
  label: string;
}

export interface ProductFamilyItem {
  productId: number;
  name: string;
  slug: string;
  href: string;
  attributes: Record<string, ProductFamilyAttributeValue>;
  image: { src: string; alt: string };
  inStock: boolean;
  purchasable: boolean;
  isCurrent: boolean;
}

export interface ProductFamilyResponse {
  family: {
    id: number;
    name: string;
    slug: string;
    attributes: Array<{ taxonomy: string; label: string }>;
  };
  currentProductId: number;
  items: ProductFamilyItem[];
}
