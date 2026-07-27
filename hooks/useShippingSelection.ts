"use client";

import { useCallback, useState } from "react";
import type { ShippingSelection } from "@/types/shipping";

export function useShippingSelection(initial?: ShippingSelection) {
  const [selection, setSelection] = useState<ShippingSelection | undefined>(
    initial,
  );

  const clearSelection = useCallback(() => setSelection(undefined), []);

  return {
    selection,
    setSelection,
    clearSelection,
  };
}
