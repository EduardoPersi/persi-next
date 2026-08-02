import type { AccountCustomer } from "@/lib/account/validation";

declare module "next-auth" {
  interface User {
    wpSessionToken?: string;
    wpSessionExpiresAt?: string;
  }

  interface Session {
    wpSessionToken?: string;
    customer?: AccountCustomer;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    wpSessionToken?: string;
    wpSessionExpiresAt?: string;
    wpValidatedAt?: number;
    customer?: AccountCustomer;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    wpSessionToken?: string;
    wpSessionExpiresAt?: string;
    wpValidatedAt?: number;
    customer?: AccountCustomer;
  }
}
