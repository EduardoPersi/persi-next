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
import type { CheckoutCustomerPayload } from "@/types/checkout";
import {
  createSingleCartInitializer,
  LatestCartRequest,
} from "@/lib/commerce/cartClient";

interface CartContextValue {
  cart: Cart | null;
  isHydrated: boolean;
  isLoading: boolean;
  isOpen: boolean;
  error: string;
  pendingItemKey: string | null;
  isCheckoutUpdating: boolean;
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
  updateCustomerAddress: (
    input: CheckoutCustomerPayload,
    signal?: AbortSignal,
  ) => Promise<CartMutationResult>;
  selectShippingRate: (
    packageId: number | string,
    rateId: string,
  ) => Promise<CartMutationResult>;
  calculateShippingPostcode: (
    postcode: string,
    signal?: AbortSignal,
  ) => Promise<CartMutationResult>;
  openCart: () => void;
  closeCart: () => void;
}

interface CartMutationResult {
  success: boolean;
  message: string;
  cart?: Cart;
  aborted?: boolean;
}

export const CartContext = createContext<CartContextValue | null>(null);

const initializeCart = createSingleCartInitializer(async () => {
  const response = await fetch("/api/cart", {
    cache: "no-store",
    credentials: "same-origin",
  });

  const result = (await response.json()) as Cart & { message?: string };
  if (!response.ok) throw new Error(result.message);
  return result;
});

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");
  const [pendingItemKey, setPendingItemKey] = useState<string | null>(null);
  const [isCheckoutUpdating, setIsCheckoutUpdating] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const latestRequest = useRef(new LatestCartRequest());

  useEffect(() => {
    let active = true;
    const requestId = latestRequest.current.start();

    async function loadCart() {
      try {
        const result = await initializeCart();
        if (active && latestRequest.current.isLatest(requestId)) setCart(result);
      } catch {
        if (active && latestRequest.current.isLatest(requestId)) {
          setError("Não foi possível carregar o carrinho.");
        }
      } finally {
        if (active && latestRequest.current.isLatest(requestId)) {
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
      const requestId = latestRequest.current.start();
      setIsLoading(true);
      setError("");

      const payload =
        typeof input === "number"
          ? { productId: input, quantity }
          : { ...input, quantity: input.quantity ?? 1 };

      try {
        const response = await fetch("/api/cart/items", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
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
          if (latestRequest.current.isLatest(requestId)) setError(message);
          return { success: false, message };
        }

        if (latestRequest.current.isLatest(requestId)) {
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
        if (latestRequest.current.isLatest(requestId)) setError(message);
        return { success: false, message };
      } finally {
        if (latestRequest.current.isLatest(requestId)) setIsLoading(false);
      }
    },
    [],
  );

  const updateItem = useCallback(async (key: string, quantity: number) => {
    await initializeCart().catch(() => undefined);
    const requestId = latestRequest.current.start();
    setIsLoading(true);
    setPendingItemKey(key);
    setError("");

    try {
      const response = await fetch("/api/cart/items", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, quantity }),
      });
      const result = (await response.json()) as Cart & { message?: string };

      if (!response.ok) {
        const message = result.message || "Não foi possível atualizar o item.";
        if (latestRequest.current.isLatest(requestId)) setError(message);
        return { success: false, message };
      }

      if (latestRequest.current.isLatest(requestId)) setCart(result);
      return { success: true, message: "Quantidade atualizada." };
    } catch {
      const message = "Não foi possível atualizar o item.";
      if (latestRequest.current.isLatest(requestId)) setError(message);
      return { success: false, message };
    } finally {
      if (latestRequest.current.isLatest(requestId)) setIsLoading(false);
      if (latestRequest.current.isLatest(requestId)) setPendingItemKey(null);
    }
  }, []);

  const removeItem = useCallback(async (key: string) => {
    await initializeCart().catch(() => undefined);
    const requestId = latestRequest.current.start();
    setIsLoading(true);
    setPendingItemKey(key);
    setError("");

    try {
      const response = await fetch("/api/cart/items", {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const result = (await response.json()) as Cart & { message?: string };

      if (!response.ok) {
        const message = result.message || "NÃ£o foi possÃ­vel remover o item.";
        if (latestRequest.current.isLatest(requestId)) setError(message);
        return { success: false, message };
      }

      if (latestRequest.current.isLatest(requestId)) setCart(result);
      return { success: true, message: "Produto removido do carrinho." };
    } catch {
      const message = "NÃ£o foi possÃ­vel remover o item.";
      if (latestRequest.current.isLatest(requestId)) setError(message);
      return { success: false, message };
    } finally {
      if (latestRequest.current.isLatest(requestId)) setIsLoading(false);
      if (latestRequest.current.isLatest(requestId)) setPendingItemKey(null);
    }
  }, []);

  const updateCustomerAddress = useCallback(
    async (
      input: CheckoutCustomerPayload,
      signal?: AbortSignal,
    ): Promise<CartMutationResult> => {
      await initializeCart().catch(() => undefined);
      const requestId = latestRequest.current.start();
      setIsCheckoutUpdating(true);
      setError("");

      try {
        const response = await fetch("/api/checkout/customer", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal,
        });
        const result = (await response.json()) as Cart & { message?: string };
        if (!response.ok) {
          const message =
            result.message || "Não foi possível calcular a entrega agora.";
          if (latestRequest.current.isLatest(requestId)) setError(message);
          return { success: false, message };
        }
        if (latestRequest.current.isLatest(requestId)) setCart(result);
        return {
          success: true,
          message: "Endereço atualizado.",
          cart: result,
        };
      } catch (requestError) {
        if (
          requestError instanceof Error &&
          requestError.name === "AbortError"
        ) {
          return { success: false, message: "", aborted: true };
        }
        const message = "Não foi possível calcular a entrega agora.";
        if (latestRequest.current.isLatest(requestId)) setError(message);
        return { success: false, message };
      } finally {
        if (latestRequest.current.isLatest(requestId)) {
          setIsCheckoutUpdating(false);
        }
      }
    },
    [],
  );

  const selectShippingRate = useCallback(
    async (
      packageId: number | string,
      rateId: string,
    ): Promise<CartMutationResult> => {
      const requestId = latestRequest.current.start();
      setIsCheckoutUpdating(true);
      setError("");
      try {
        const response = await fetch("/api/checkout/shipping", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packageId, rateId }),
        });
        const result = (await response.json()) as Cart & { message?: string };
        if (!response.ok) {
          const message =
            result.message || "Não foi possível selecionar a entrega.";
          if (latestRequest.current.isLatest(requestId)) setError(message);
          return { success: false, message };
        }
        if (latestRequest.current.isLatest(requestId)) setCart(result);
        return {
          success: true,
          message: "Opção de entrega atualizada.",
          cart: result,
        };
      } catch {
        const message = "Não foi possível selecionar a entrega.";
        if (latestRequest.current.isLatest(requestId)) setError(message);
        return { success: false, message };
      } finally {
        if (latestRequest.current.isLatest(requestId)) {
          setIsCheckoutUpdating(false);
        }
      }
    },
    [],
  );

  const calculateShippingPostcode = useCallback(
    async (
      postcode: string,
      signal?: AbortSignal,
    ): Promise<CartMutationResult> => {
      const requestId = latestRequest.current.start();
      setIsCheckoutUpdating(true);
      setError("");
      try {
        const response = await fetch("/api/shipping/cart", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postcode }),
          signal,
        });
        const result = (await response.json()) as Cart & { message?: string };
        if (!response.ok) {
          const message =
            result.message || "Não foi possível calcular o frete agora.";
          if (latestRequest.current.isLatest(requestId)) setError(message);
          return { success: false, message };
        }
        if (latestRequest.current.isLatest(requestId)) setCart(result);
        return {
          success: true,
          message: "Opções de frete atualizadas.",
          cart: result,
        };
      } catch (requestError) {
        if (
          requestError instanceof Error &&
          requestError.name === "AbortError"
        ) {
          return { success: false, message: "", aborted: true };
        }
        const message = "Não foi possível calcular o frete agora.";
        if (latestRequest.current.isLatest(requestId)) setError(message);
        return { success: false, message };
      } finally {
        if (latestRequest.current.isLatest(requestId)) {
          setIsCheckoutUpdating(false);
        }
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      cart,
      isHydrated,
      isLoading,
      isOpen,
      error,
      pendingItemKey,
      isCheckoutUpdating,
      addItem,
      updateItem,
      removeItem,
      updateCustomerAddress,
      selectShippingRate,
      calculateShippingPostcode,
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
      isCheckoutUpdating,
      pendingItemKey,
      removeItem,
      selectShippingRate,
      calculateShippingPostcode,
      updateItem,
      updateCustomerAddress,
    ],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}
