"use client";

import { Suspense } from "react";
import { useNavigation } from "./NavigationProvider";
import { MegaMenuDesktop } from "./MegaMenuDesktop";

export function MegaMenu() {
  const menu = useNavigation();
  return <Suspense fallback={null}><MegaMenuDesktop menu={menu} /></Suspense>;
}
