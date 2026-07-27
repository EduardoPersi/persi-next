"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCart } from "@/hooks/useCart";
import {
  formatPostcode,
  isValidPostcode,
  normalizePostcode,
  readLastShippingPostcode,
  readShippingCache,
  writeLastShippingPostcode,
  writeShippingCache,
} from "@/lib/commerce/shippingCalculator";
import type { CheckoutShippingPackage } from "@/types/cart";
import type {
  ProductShippingInput,
  SelectedShippingRate,
  ShippingQuote,
  ShippingSelection,
} from "@/types/shipping";
import { useShippingSelection } from "./useShippingSelection";

interface UseShippingCalculatorOptions {
  contextKey: string;
  mode: "cart" | "product";
  product?: ProductShippingInput;
  onSelectionChange?: (selection?: SelectedShippingRate) => void;
}

type ShippingStatus = "idle" | "loading" | "ready" | "error" | "empty";

const GENERIC_ERROR = "Não foi possível calcular o frete. Tente novamente.";

function countRates(packages: CheckoutShippingPackage[]): number {
  return packages.reduce((total, item) => total + item.rates.length, 0);
}

export function useShippingCalculator({
  contextKey,
  mode,
  product,
  onSelectionChange,
}: UseShippingCalculatorOptions) {
  const {
    calculateShippingPostcode,
    isCheckoutUpdating,
    selectShippingRate,
  } = useCart();
  const [postcode, setPostcodeState] = useState("");
  const [quote, setQuote] = useState<ShippingQuote>({ packages: [] });
  const [status, setStatus] = useState<ShippingStatus>("idle");
  const [message, setMessage] = useState("");
  const { selection, setSelection, clearSelection } = useShippingSelection();
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const lastSuccessfulKey = useRef("");
  const activeRequestKey = useRef("");

  const persist = useCallback(
    (
      nextPostcode: string,
      nextQuote: ShippingQuote,
      nextSelection?: ShippingSelection,
    ) => {
      if (typeof window === "undefined") return;
      writeShippingCache(window.localStorage, {
        contextKey,
        postcode: nextPostcode,
        quote: nextQuote,
        selected: nextSelection,
        timestamp: Date.now(),
      });
      writeLastShippingPostcode(window.localStorage, nextPostcode);
    },
    [contextKey],
  );

  useEffect(() => {
    activeRequest.current?.abort();
    requestSequence.current += 1;
    lastSuccessfulKey.current = "";
    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      clearSelection();
      setMessage("");

      if (typeof window === "undefined") return;
      const cached = readShippingCache(window.localStorage, contextKey);

      if (!cached) {
        setPostcodeState(
          formatPostcode(readLastShippingPostcode(window.localStorage)),
        );
        setQuote({ packages: [] });
        setStatus("idle");
        return;
      }

      setPostcodeState(formatPostcode(cached.postcode));
      setQuote(cached.quote);
      setSelection(cached.selected);
      if (cached.selected) {
        const selectedPackage = cached.quote.packages.find(
          (item) => item.packageId === cached.selected?.packageId,
        );
        const selectedRate = selectedPackage?.rates.find(
          (rate) => rate.rateId === cached.selected?.rateId,
        );
        if (selectedRate) {
          onSelectionChange?.({ ...cached.selected, rate: selectedRate });
        }
      }
      setStatus(countRates(cached.quote.packages) ? "ready" : "empty");
      lastSuccessfulKey.current = `${contextKey}:${cached.postcode}`;
    });

    return () => {
      active = false;
    };
  }, [clearSelection, contextKey, onSelectionChange, setSelection]);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [],
  );

  const calculate = useCallback(
    async (requestedPostcode = postcode) => {
      const digits = normalizePostcode(requestedPostcode);

      if (!isValidPostcode(digits)) {
        setStatus("error");
        setMessage("Informe um CEP válido no formato 99999-999.");
        return;
      }

      const requestKey = `${contextKey}:${digits}`;
      if (activeRequestKey.current === requestKey) return;
      if (
        requestKey === lastSuccessfulKey.current &&
        countRates(quote.packages) > 0
      ) {
        return;
      }

      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      const sequence = ++requestSequence.current;
      activeRequestKey.current = requestKey;
      setStatus("loading");
      setMessage("");

      try {
        let nextQuote: ShippingQuote;

        if (mode === "cart") {
          const result = await calculateShippingPostcode(
            digits,
            controller.signal,
          );
          if (result.aborted) return;
          if (!result.success || !result.cart) {
            throw new Error(result.message || GENERIC_ERROR);
          }
          nextQuote = {
            destination: result.cart.shippingDestination,
            packages: result.cart.shippingPackages,
          };
        } else {
          if (!product) {
            throw new Error("Selecione uma variação para calcular o frete.");
          }
          const response = await fetch("/api/shipping/product", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...product, postcode: digits }),
            signal: controller.signal,
          });
          const body = (await response.json().catch(() => null)) as
            | {
                destination?: ShippingQuote["destination"];
                message?: string;
                shippingPackages?: CheckoutShippingPackage[];
              }
            | null;
          if (!response.ok) {
            throw new Error(body?.message || GENERIC_ERROR);
          }
          nextQuote = {
            destination: body?.destination,
            packages: Array.isArray(body?.shippingPackages)
              ? body.shippingPackages
              : [],
          };
        }

        if (sequence !== requestSequence.current) return;

        setPostcodeState(formatPostcode(digits));
        setQuote(nextQuote);
        const officiallySelectedRate =
          mode === "cart"
            ? nextQuote.packages.flatMap((shippingPackage) =>
                shippingPackage.rates
                  .filter((rate) => rate.selected)
                  .map((rate) => ({
                    packageId: shippingPackage.packageId,
                    postcode: digits,
                    rate,
                    rateId: rate.rateId,
                  })),
              )[0]
            : undefined;
        const officiallySelected = officiallySelectedRate
          ? {
              packageId: officiallySelectedRate.packageId,
              postcode: digits,
              rateId: officiallySelectedRate.rateId,
            }
          : undefined;
        if (officiallySelected && officiallySelectedRate) {
          setSelection(officiallySelected);
          onSelectionChange?.({
            ...officiallySelected,
            rate: officiallySelectedRate.rate,
          });
        } else {
          clearSelection();
          onSelectionChange?.(undefined);
        }
        lastSuccessfulKey.current = requestKey;

        if (!countRates(nextQuote.packages)) {
          setStatus("empty");
          setMessage("Não encontramos opções de frete para este CEP.");
          persist(digits, nextQuote, officiallySelected);
          return;
        }

        setStatus("ready");
        setMessage("Opções de frete atualizadas.");
        persist(digits, nextQuote, officiallySelected);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (sequence !== requestSequence.current) return;
        setStatus("error");
        setMessage(error instanceof Error && error.message
          ? error.message
          : GENERIC_ERROR);
      } finally {
        if (sequence === requestSequence.current) {
          activeRequestKey.current = "";
        }
      }
    },
    [
      calculateShippingPostcode,
      clearSelection,
      contextKey,
      mode,
      onSelectionChange,
      persist,
      postcode,
      product,
      quote.packages,
      setSelection,
    ],
  );

  useEffect(() => {
    const digits = normalizePostcode(postcode);
    if (!isValidPostcode(digits)) return;
    const timer = window.setTimeout(() => {
      void calculate(digits);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [calculate, postcode]);

  const chooseRate = useCallback(
    async (packageId: number | string, rateId: string) => {
      if (status === "loading" || isCheckoutUpdating) return;
      const shippingPackage = quote.packages.find(
        (item) => item.packageId === packageId,
      );
      const rate = shippingPackage?.rates.find(
        (item) => item.rateId === rateId,
      );
      if (!rate) return;

      setMessage("");

      let quoteToPersist = quote;

      if (mode === "cart") {
        const result = await selectShippingRate(packageId, rateId);
        if (!result.success || !result.cart) {
          setStatus("error");
          setMessage(result.message || "Não foi possível selecionar o frete.");
          return;
        }
        const nextQuote = {
          destination: quote.destination,
          packages: result.cart.shippingPackages,
        };
        setQuote(nextQuote);
        quoteToPersist = nextQuote;
      }

      const nextSelection = {
        packageId,
        postcode: normalizePostcode(postcode),
        rateId,
      };
      setSelection(nextSelection);
      onSelectionChange?.({ ...nextSelection, rate });
      persist(normalizePostcode(postcode), quoteToPersist, nextSelection);
      setStatus("ready");
      setMessage("Opção de frete selecionada.");
    },
    [
      isCheckoutUpdating,
      mode,
      onSelectionChange,
      persist,
      postcode,
      quote,
      selectShippingRate,
      setSelection,
      status,
    ],
  );

  return {
    postcode,
    quote,
    selection,
    status,
    message,
    isLoading: status === "loading" || isCheckoutUpdating,
    setPostcode: (value: string) => {
      setPostcodeState(formatPostcode(value));
      setMessage("");
      if (!isValidPostcode(value)) setStatus("idle");
    },
    calculate,
    chooseRate,
    reset: () => {
      activeRequest.current?.abort();
      requestSequence.current += 1;
      activeRequestKey.current = "";
      lastSuccessfulKey.current = "";
      setPostcodeState("");
      setQuote({ packages: [] });
      clearSelection();
      onSelectionChange?.(undefined);
      setStatus("idle");
      setMessage("");
    },
  };
}
