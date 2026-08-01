"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { MegaMenuData } from "@/lib/navigation/types";

const EMPTY_MENU: MegaMenuData = {
  categories: [],
  featuredBrands: [],
  promotions: [],
  generatedAt: "",
};

const NavigationContext = createContext<MegaMenuData>(EMPTY_MENU);

export function NavigationProvider({
  menu,
  children,
}: {
  menu: MegaMenuData;
  children: ReactNode;
}) {
  return (
    <NavigationContext.Provider value={menu}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  return useContext(NavigationContext);
}
