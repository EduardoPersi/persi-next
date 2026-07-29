import type { AccountCustomer } from "./validation";

export function getAccountGreetingName(
  customer: Pick<AccountCustomer, "firstName" | "displayName">,
): string {
  return customer.firstName.trim() || customer.displayName.trim();
}
