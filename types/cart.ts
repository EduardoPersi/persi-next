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
  freeShipping?: boolean;
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

export interface CartMoney {
  value: string;
  currencyCode: string;
  currencySymbol: string;
  currencyMinorUnit: number;
}

export interface CartCoupon {
  code: string;
  discountType?: string;
  totalDiscount: CartMoney;
  totalDiscountTax: CartMoney;
}

export interface CartFee {
  key: string;
  name: string;
  total: CartMoney;
  totalTax: CartMoney;
}

export interface CartTaxLine {
  name: string;
  price: CartMoney;
  rate?: string;
}

export interface CartAddress {
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface CheckoutShippingRate {
  packageId: number | string;
  rateId: string;
  name: string;
  description?: string;
  deliveryTime?: string;
  price: CartMoney;
  selected: boolean;
  methodId?: string;
  instanceId?: string;
  metaData?: Array<{
    key: string;
    value: string;
  }>;
}

export interface CheckoutShippingPackage {
  packageId: number | string;
  name?: string;
  destination?: CartAddress;
  rates: CheckoutShippingRate[];
}

export interface CartTotals {
  items: CartMoney;
  itemsTax: CartMoney;
  fees: CartMoney;
  feesTax: CartMoney;
  discount: CartMoney;
  discountTax: CartMoney;
  shipping: CartMoney;
  shippingTax: CartMoney;
  price: CartMoney;
  tax: CartMoney;
}

export interface Cart {
  items: CartItem[];
  itemsCount: number;
  subtotal: number;
  currencyCode: string;
  currencySymbol: string;
  currencyMinorUnit: number;
  coupons: CartCoupon[];
  fees: CartFee[];
  taxLines: CartTaxLine[];
  totals: CartTotals;
  shippingAddress?: CartAddress;
  shippingDestination?: CartAddress;
  billingAddress?: CartAddress;
  needsShipping: boolean;
  hasCalculatedShipping: boolean;
  shippingPackages: CheckoutShippingPackage[];
}
