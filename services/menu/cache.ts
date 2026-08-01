import "server-only";

import { revalidateTag } from "next/cache";
import { MEGA_MENU_CACHE_TAG } from "@/lib/navigation/MenuCache";

/** Deve ser chamada apenas por um webhook autenticado do WooCommerce. */
export function invalidateMegaMenuCache() {
  revalidateTag(MEGA_MENU_CACHE_TAG, "max");
}
