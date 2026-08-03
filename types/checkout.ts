export type CheckoutAddress = {
  postalCode: string;
  addressLine1: string;
  number: string;
  addressLine2: string;
  neighborhood: string;
  city: string;
  state: string;
  country: "BR";
};

export type CheckoutPersonType = "fisica" | "juridica";

export type CheckoutFormValues = {
  contact: {
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    phone: string;
    personType: CheckoutPersonType;
    document: string;
  };
  billingAddress: CheckoutAddress;
  shipToBillingAddress: boolean;
  shippingAddress: CheckoutAddress;
  acceptsTerms: boolean;
};

export type CheckoutStoreAddress = {
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postcode: string;
  country: "BR";
  email?: string;
  phone?: string;
};

export type CheckoutCustomerPayload = {
  billingAddress: CheckoutStoreAddress;
  shippingAddress: CheckoutStoreAddress;
};

export type CheckoutViewState = "loading" | "error" | "empty" | "ready";

export type ShippingStatus =
  | "idle"
  | "validating"
  | "updating-address"
  | "loading-rates"
  | "ready"
  | "selecting-rate"
  | "unavailable"
  | "error";
