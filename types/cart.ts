export interface CartItem {
  key: string;
  id: number;
  name: string;
  quantity: number;
  maxQuantity?: number;
  image?: {
    src: string;
    alt: string;
  };
  price: number;
  total: number;
}

export interface Cart {
  items: CartItem[];
  itemsCount: number;
  subtotal: number;
  currencyCode: string;
  currencySymbol: string;
  currencyMinorUnit: number;
}
