"use client";

import { useCallback, useState } from "react";

export function useMegaMenu() {
  const [openMenuId, setOpenMenuId] = useState<number | "all" | null>(null);
  const closeMenu = useCallback(() => setOpenMenuId(null), []);

  return { openMenuId, setOpenMenuId, closeMenu };
}
