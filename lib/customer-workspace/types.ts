export interface CustomerWorkspaceSummary {
  orders: number;
  favorites: number;
  lists: number;
  addresses: number;
}

export interface CustomerWorkspaceProfile {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  birthDate: string;
  cpf: string;
}

export type CustomerAddressType = "billing" | "shipping";
export interface CustomerWorkspaceAddress {
  id: CustomerAddressType;
  type: CustomerAddressType;
  label: string;
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
  isPrimary: boolean;
}

export interface ConnectedAccount {
  provider: "google" | "facebook";
  connected: boolean;
}

export interface StockNotificationSubscription {
  id: number;
  productId: number;
  productName: string;
  productUrl: string;
  status: string;
  createdAt: string;
  notified: boolean;
}
