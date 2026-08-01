import { mergeAnonymousCustomerLists } from "@/lib/customer-lists/sync";

export async function mergeAnonymousFavorites(): Promise<number[]> {
  return (await mergeAnonymousCustomerLists()).favorites;
}
