"use client";

import { useContext } from "react";
import { CartContext } from "@/components/Cart/CartProvider";

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart deve ser usado dentro de CartProvider.");
  }

  return context;
}
