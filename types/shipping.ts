import type {
  CartAddress,
  CheckoutShippingPackage,
  CheckoutShippingRate,
} from "./cart";

export interface ProductShippingInput {
  productId: number;
  variationId?: number;
  quantity: number;
  variation?: Array<{
    attribute: string;
    value: string;
  }>;
}

export interface ShippingSelection {
  packageId: number | string;
  postcode: string;
  rateId: string;
}

export interface ShippingQuote {
  destination?: CartAddress;
  packages: CheckoutShippingPackage[];
}

export interface SelectedShippingRate extends ShippingSelection {
  rate: CheckoutShippingRate;
}
