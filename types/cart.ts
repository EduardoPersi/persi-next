export interface CartItem {
  key: string;
  id: number;
  productId: number;
  variationId?: number;
  name: string;
  sku?: string;
  permalink?: string;
  slug?: string;
  variation: Array<{
    attribute: string;
    label: string;
    value: string;
  }>;
  quantity: number;
  minQuantity: number;
  maxQuantity?: number;
  quantityStep: number;
  image?: {
    src: string;
    alt: string;
  };
  price: number;
  total: number;
}

export interface AddCartItemInput {
  productId: number;
  quantity?: number;
  variationId?: number;
  variation?: Array<{
    attribute: string;
    value: string;
  }>;
}

export interface Cart {
  items: CartItem[];
  itemsCount: number;
  subtotal: number;
  currencyCode: string;
  currencySymbol: string;
  currencyMinorUnit: number;
}
