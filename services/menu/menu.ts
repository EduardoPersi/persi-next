import "server-only";

import { unstable_cache } from "next/cache";
import { buildCategoryTree } from "@/lib/navigation/CategoryTree";
import {
  MEGA_MENU_CACHE_TAG,
  MEGA_MENU_REVALIDATE_SECONDS,
} from "@/lib/navigation/MenuCache";
import type { MegaMenuData } from "@/lib/navigation/types";
import { getAllProductBrands } from "@/services/woocommerce/brands";
import { getAllProductCategories } from "@/services/woocommerce/categories";

const EMPTY_MENU: MegaMenuData = {
  categories: [],
  featuredBrands: [],
  promotions: [],
  generatedAt: "",
};

let lastKnownGoodMenu: MegaMenuData | undefined;

async function loadMegaMenu(): Promise<MegaMenuData> {
  const categories = await getAllProductCategories({
    hideEmpty: true,
    revalidate: MEGA_MENU_REVALIDATE_SECONDS,
  });
  const brands = await getAllProductBrands().catch(() => []);

  return {
    categories: buildCategoryTree(categories),
    featuredBrands: brands
      .filter((brand) => brand.name.trim())
      .sort((first, second) => second.count - first.count)
      .slice(0, 8),
    promotions: [],
    generatedAt: new Date().toISOString(),
  };
}

const getCachedMegaMenu = unstable_cache(loadMegaMenu, ["mega-menu-v1"], {
  revalidate: MEGA_MENU_REVALIDATE_SECONDS,
  tags: [MEGA_MENU_CACHE_TAG],
});

export async function getMegaMenuData(): Promise<MegaMenuData> {
  try {
    const menu = await getCachedMegaMenu();
    lastKnownGoodMenu = menu;
    return menu;
  } catch {
    return lastKnownGoodMenu ?? EMPTY_MENU;
  }
}
