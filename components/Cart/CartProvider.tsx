"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AddCartItemInput, Cart } from "@/types/cart";

interface CartContextValue {
  cart: Cart | null;
  isHydrated: boolean;
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

let cartInitializationPromise: Promise<Cart> | null = null;

function initializeCart() {
  cartInitializationPromise ??= fetch("/api/cart", {
    cache: "no-store",
    credentials: "same-origin",
  }).then(async (response) => {
    const result = (await response.json()) as Cart & { message?: string };
    if (!response.ok) throw new Error(result.message);
    return result;
  });

  return cartInitializationPromise;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");
  const [pendingItemKey, setPendingItemKey] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const latestRequestId = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = ++latestRequestId.current;

    async function loadCart() {
      try {
        const result = await initializeCart();
        if (active && requestId === latestRequestId.current) setCart(result);
      } catch {
        if (active && requestId === latestRequestId.current) {
          setError("Não foi possível carregar o carrinho.");
        }
      } finally {
        if (active && requestId === latestRequestId.current) {
          setIsHydrated(true);
          setIsLoading(false);
        }
      }
    }

    void loadCart();
    return () => {
      active = false;
    };
  }, []);

  const addItem = useCallback(
    async (input: number | AddCartItemInput, quantity = 1) => {
      await initializeCart().catch(() => undefined);
      const requestId = ++latestRequestId.current;
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
          if (requestId === latestRequestId.current) setError(message);
          return { success: false, message };
        }

        if (requestId === latestRequestId.current) {
          setCart(result);
          setIsOpen(true);
        }
        return {
          success: true,
          message: "Produto adicionado ao carrinho.",
        };
      } catch {
        const message =
          "Não foi possível adicionar o produto. Tente novamente.";
        if (requestId === latestRequestId.current) setError(message);
        return { success: false, message };
      } finally {
        if (requestId === latestRequestId.current) setIsLoading(false);
      }
    },
    [],
  );

  const updateItem = useCallback(async (key: string, quantity: number) => {
    await initializeCart().catch(() => undefined);
    const requestId = ++latestRequestId.current;
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
        if (requestId === latestRequestId.current) setError(message);
        return { success: false, message };
      }

      if (requestId === latestRequestId.current) setCart(result);
      return { success: true, message: "Quantidade atualizada." };
    } catch {
      const message = "Não foi possível atualizar o item.";
      if (requestId === latestRequestId.current) setError(message);
      return { success: false, message };
    } finally {
      if (requestId === latestRequestId.current) setIsLoading(false);
      if (requestId === latestRequestId.current) setPendingItemKey(null);
    }
  }, []);

  const removeItem = useCallback(async (key: string) => {
    await initializeCart().catch(() => undefined);
    const requestId = ++latestRequestId.current;
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
        if (requestId === latestRequestId.current) setError(message);
        return { success: false, message };
      }

      if (requestId === latestRequestId.current) setCart(result);
      return { success: true, message: "Produto removido do carrinho." };
    } catch {
      const message = "NÃ£o foi possÃ­vel remover o item.";
      if (requestId === latestRequestId.current) setError(message);
      return { success: false, message };
    } finally {
      if (requestId === latestRequestId.current) setIsLoading(false);
      if (requestId === latestRequestId.current) setPendingItemKey(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      cart,
      isHydrated,
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
    [
      addItem,
      cart,
      error,
      isHydrated,
      isLoading,
      isOpen,
      pendingItemKey,
      removeItem,
      updateItem,
    ],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}
