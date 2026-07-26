export interface BoughtTogetherItem {
  productId: number;
  name: string;
  slug: string;
  href: string;
  price: string;
  currencyCode: string;
  image: { src: string; alt: string };
  inStock: boolean;
  purchasable: boolean;
  suggestedQuantity: number;
}

export interface BoughtTogetherResponse {
  productId: number;
  items: BoughtTogetherItem[];
}
