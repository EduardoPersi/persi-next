import type { ProductBrand } from "@/types/brand";
import type { NavigationCategory } from "./CategoryTree";

export interface MegaMenuPromotion {
  id: string;
  title: string;
  href: string;
  image?: string;
}

export interface MegaMenuData {
  categories: NavigationCategory[];
  featuredBrands: ProductBrand[];
  promotions: MegaMenuPromotion[];
  generatedAt: string;
}
