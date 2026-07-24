"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AddCartItemInput, Cart } from "@/types/cart";

interface CartContextValue {
  cart: Cart | null;
  isLoading: boolean;
  isOpen: boolean;
  error: string;
  pendingItemKey: string | null;
  addItem: (
    input: number | AddCartItemInput,
    quantity?: number,
  ) => Promise<{ success: boolean; message: string }>;
  removeItem: (
    key: string,
  ) => Promise<{ success: boolean; message: string }>;
  updateItem: (
    key: string,
    quantity: number,
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
  const [pendingItemKey, setPendingItemKey] = useState<string | null>(null);

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
    async (input: number | AddCartItemInput, quantity = 1) => {
      setIsLoading(true);
      setError("");

      const payload =
        typeof input === "number"
          ? { productId: input, quantity }
          : { ...input, quantity: input.quantity ?? 1 };

      try {
        const response = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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

  const updateItem = useCallback(async (key: string, quantity: number) => {
    setIsLoading(true);
    setPendingItemKey(key);
    setError("");

    try {
      const response = await fetch("/api/cart/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, quantity }),
      });
      const result = (await response.json()) as Cart & { message?: string };

      if (!response.ok) {
        const message = result.message || "Não foi possível atualizar o item.";
        setError(message);
        return { success: false, message };
      }

      setCart(result);
      return { success: true, message: "Quantidade atualizada." };
    } catch {
      const message = "Não foi possível atualizar o item.";
      setError(message);
      return { success: false, message };
    } finally {
      setIsLoading(false);
      setPendingItemKey(null);
    }
  }, []);

  const removeItem = useCallback(async (key: string) => {
    setIsLoading(true);
    setPendingItemKey(key);
    setError("");

    try {
      const response = await fetch("/api/cart/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const result = (await response.json()) as Cart & { message?: string };

      if (!response.ok) {
        const message = result.message || "NÃ£o foi possÃ­vel remover o item.";
        setError(message);
        return { success: false, message };
      }

      setCart(result);
      return { success: true, message: "Produto removido do carrinho." };
    } catch {
      const message = "NÃ£o foi possÃ­vel remover o item.";
      setError(message);
      return { success: false, message };
    } finally {
      setIsLoading(false);
      setPendingItemKey(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      cart,
      isLoading,
      isOpen,
      error,
      pendingItemKey,
      addItem,
      updateItem,
      removeItem,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
    }),
    [addItem, cart, error, isLoading, isOpen, pendingItemKey, removeItem, updateItem],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}
