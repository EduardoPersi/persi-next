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
  shouldStartAutomaticShippingRequest,
  writeLastShippingPostcode,
  writeShippingCache,
} from "@/lib/commerce/shippingCalculator";
import { pushToDataLayer } from "@/lib/analytics/gtm";
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

type ShippingStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "invalid_cep"
  | "network_error"
  | "server_error";

const NETWORK_ERROR =
  "Não foi possível consultar o frete neste momento. Verifique sua conexão e tente novamente.";
const SERVER_ERROR =
  "Estamos com uma instabilidade temporária no cálculo de frete. Tente novamente em alguns instantes.";
const SHIPPING_LOOKUP_TIMEOUT_MS = 20_000;

class ShippingLookupError extends Error {
  constructor(
    readonly kind: "network_error" | "server_error",
    message: string,
  ) {
    super(message);
    this.name = "ShippingLookupError";
  }
}

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
  const lastCompletedKey = useRef("");
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
    lastCompletedKey.current = "";
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
      setStatus(countRates(cached.quote.packages) ? "success" : "empty");
      lastCompletedKey.current = `${contextKey}:${cached.postcode}`;
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
    async (
      requestedPostcode = postcode,
      options: { force?: boolean } = { force: true },
    ) => {
      const digits = normalizePostcode(requestedPostcode);

      if (!isValidPostcode(digits)) {
        setStatus("invalid_cep");
        setMessage("CEP inválido. Confira os números informados.");
        pushToDataLayer({ event: "shipping_invalid_cep", shipping_context: mode });
        return;
      }

      const requestKey = `${contextKey}:${digits}`;
      if (activeRequestKey.current === requestKey) return;
      if (
        !options.force &&
        !shouldStartAutomaticShippingRequest(
          requestKey,
          activeRequestKey.current,
          lastCompletedKey.current,
        )
      ) return;

      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      const sequence = ++requestSequence.current;
      activeRequestKey.current = requestKey;
      let timedOut = false;
      const requestTimeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SHIPPING_LOOKUP_TIMEOUT_MS);
      setStatus("loading");
      setMessage("Calculando opções de entrega...");
      pushToDataLayer({ event: "shipping_lookup", shipping_context: mode });

      try {
        let nextQuote: ShippingQuote;

        if (mode === "cart") {
          const result = await calculateShippingPostcode(
            digits,
            controller.signal,
          );
          if (result.aborted) {
            if (timedOut) {
              throw new ShippingLookupError("server_error", SERVER_ERROR);
            }
            return;
          }
          if (!result.success || !result.cart) {
            throw new ShippingLookupError(
              typeof navigator !== "undefined" && !navigator.onLine
                ? "network_error"
                : "server_error",
              typeof navigator !== "undefined" && !navigator.onLine
                ? NETWORK_ERROR
                : SERVER_ERROR,
            );
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
            throw new ShippingLookupError("server_error", SERVER_ERROR);
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
        lastCompletedKey.current = requestKey;

        if (!countRates(nextQuote.packages)) {
          setStatus("empty");
          setMessage("");
          persist(digits, nextQuote, officiallySelected);
          pushToDataLayer({ event: "shipping_empty", shipping_context: mode });
          return;
        }

        setStatus("success");
        setMessage("Opções de frete atualizadas.");
        persist(digits, nextQuote, officiallySelected);
        pushToDataLayer({
          event: "shipping_success",
          shipping_context: mode,
          shipping_option_count: countRates(nextQuote.packages),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError" && !timedOut) {
          return;
        }
        if (sequence !== requestSequence.current) return;
        lastCompletedKey.current = requestKey;
        const errorStatus =
          error instanceof ShippingLookupError
            ? error.kind
            : error instanceof TypeError
              ? "network_error"
              : "server_error";
        setStatus(errorStatus);
        setMessage(errorStatus === "network_error" ? NETWORK_ERROR : SERVER_ERROR);
        pushToDataLayer({
          event: "shipping_error",
          shipping_context: mode,
          shipping_error_type: errorStatus,
        });
      } finally {
        window.clearTimeout(requestTimeout);
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
      setSelection,
    ],
  );

  useEffect(() => {
    const digits = normalizePostcode(postcode);
    if (!isValidPostcode(digits)) return;
    const timer = window.setTimeout(() => {
      void calculate(digits, { force: false });
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
          setStatus("server_error");
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
      setStatus("success");
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
      const nextPostcode = formatPostcode(value);
      if (normalizePostcode(nextPostcode) !== normalizePostcode(postcode)) {
        activeRequest.current?.abort();
        requestSequence.current += 1;
        activeRequestKey.current = "";
        setQuote({ packages: [] });
        clearSelection();
        onSelectionChange?.(undefined);
        setStatus("idle");
      }
      setPostcodeState(nextPostcode);
      setMessage("");
      if (!isValidPostcode(value)) setStatus("idle");
    },
    calculate,
    chooseRate,
    reset: () => {
      activeRequest.current?.abort();
      requestSequence.current += 1;
      activeRequestKey.current = "";
      lastCompletedKey.current = "";
      setPostcodeState("");
      setQuote({ packages: [] });
      clearSelection();
      onSelectionChange?.(undefined);
      setStatus("idle");
      setMessage("");
    },
  };
}
