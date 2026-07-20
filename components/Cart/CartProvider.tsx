"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Cart } from "@/types/cart";

interface CartContextValue {
  cart: Cart | null;
  isLoading: boolean;
  isOpen: boolean;
  error: string;
  addItem: (
    productId: number,
    quantity?: number,
  ) => Promise<{ success: boolean; message: string }>;
  openCart: () => void;
  closeCart: () => void;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadCart() {
      try {
        const response = await fetch("/api/cart", {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) throw new Error();
        setCart((await response.json()) as Cart);
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }
        setError("Não foi possível carregar o carrinho.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadCart();
    return () => controller.abort();
  }, []);

  const addItem = useCallback(
    async (productId: number, quantity = 1) => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, quantity }),
        });
        const result = (await response.json()) as Cart & {
          message?: string;
        };

        if (!response.ok) {
          const message =
            result.message ||
            "Não foi possível adicionar o produto. Tente novamente.";
          setError(message);
          return { success: false, message };
        }

        setCart(result);
        setIsOpen(true);
        return {
          success: true,
          message: "Produto adicionado ao carrinho.",
        };
      } catch {
        const message =
          "Não foi possível adicionar o produto. Tente novamente.";
        setError(message);
        return { success: false, message };
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      cart,
      isLoading,
      isOpen,
      error,
      addItem,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
    }),
    [addItem, cart, error, isLoading, isOpen],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}
