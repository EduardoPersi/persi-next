"use client";

import Image from "next/image";
import Link from "next/link";
import { LoaderCircle, Search } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  ProductSearchSuggestion,
  ProductSearchSuggestionsResponse,
} from "@/types/search";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useOverlayManager } from "@/hooks/useOverlayManager";
import { useRouteTransition } from "@/hooks/useRouteTransition";
import { getProductHref } from "@/lib/routing/storefrontUrls";

interface ProductSearchProps {
  variant: "desktop" | "mobile";
  compact?: boolean;
}

type SuggestionsStatus = "idle" | "loading" | "success" | "error";

const MINIMUM_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 300;
const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

function formatCurrency(value: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currencyCode,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  }
}

export function ProductSearch({
  variant,
  compact = false,
}: ProductSearchProps) {
  const { navigate } = useRouteTransition();
  const resultsId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductSearchSuggestion[]>([]);
  const [status, setStatus] = useState<SuggestionsStatus>("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const trimmedQuery = query.trim();
  const canSuggest = trimmedQuery.length >= MINIMUM_QUERY_LENGTH;
  const isSearchActive = (isFocused && Boolean(trimmedQuery)) || isOpen;

  useEffect(() => {
    if (!canSuggest || !isFocused) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStatus("loading");
      setIsOpen(true);

      try {
        const response = await fetch(
          `/api/search/suggestions?q=${encodeURIComponent(trimmedQuery)}`,
          { signal: controller.signal },
        );

        if (!response.ok) throw new Error("Search request failed");

        const result =
          (await response.json()) as ProductSearchSuggestionsResponse;
        setProducts(result.products);
        setActiveIndex(-1);
        setStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setProducts([]);
        setStatus("error");
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canSuggest, isFocused, trimmedQuery]);

  function closeSearch() {
    setIsOpen(false);
    setIsFocused(false);
    setActiveIndex(-1);
  }

  useOverlayManager({
    id: `product-search-${resultsId}`,
    isOpen: isSearchActive,
    onClose: closeSearch,
  });
  useClickOutside({
    isOpen: isSearchActive,
    refs: [containerRef],
    onOutside: closeSearch,
  });

  useEffect(() => {
    if (!isSearchActive) return;

    const header =
      containerRef.current?.closest("[data-search-header]") ??
      containerRef.current?.closest("header");
    const overlay = overlayRef.current;
    if (!header || !overlay) return;

    function updateOverlayTop() {
      const currentHeader =
        containerRef.current?.closest("[data-search-header]") ??
        containerRef.current?.closest("header");
      const currentOverlay = overlayRef.current;
      if (!currentHeader || !currentOverlay) return;

      currentOverlay.style.top = `${Math.max(0, currentHeader.getBoundingClientRect().bottom)}px`;
    }

    updateOverlayTop();
    window.addEventListener("resize", updateOverlayTop);
    window.addEventListener("scroll", updateOverlayTop, { passive: true });

    return () => {
      window.removeEventListener("resize", updateOverlayTop);
      window.removeEventListener("scroll", updateOverlayTop);
    };
  }, [isSearchActive]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedQuery) return;

    closeSearch();
    navigate(`/busca?q=${encodeURIComponent(trimmedQuery)}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      event.currentTarget.blur();
      return;
    }

    if (status !== "success" || products.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current + 1) % products.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? products.length - 1 : current - 1,
      );
    } else if (event.key === "Home" && isOpen) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && isOpen) {
      event.preventDefault();
      setActiveIndex(products.length - 1);
    } else if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      event.preventDefault();
      const product = products[activeIndex];
      closeSearch();
      navigate(getProductHref(product.slug));
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setActiveIndex(-1);

    if (value.trim().length < MINIMUM_QUERY_LENGTH) {
      setProducts([]);
      setStatus("idle");
      setIsOpen(false);
    }
  }

  const isDesktop = variant === "desktop";
  const isLoading = status === "loading" && isSearchActive;

  return (
    <div
      ref={containerRef}
      className={
        isDesktop
          ? "relative hidden flex-1 md:block"
          : compact
            ? "relative md:hidden"
            : "relative md:hidden"
      }
    >
      <form
        className={`flex overflow-hidden bg-white ${
          isDesktop ? "h-[42px] rounded-md" : "h-10 rounded-xl"
        }`}
        role="search"
        onSubmit={submitSearch}
      >
        <input
          type="search"
          role="combobox"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => {
            setIsFocused(true);
            if (canSuggest) setIsOpen(true);
          }}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={
            isDesktop
              ? "Pesquisar produtos na Persi"
              : compact
                ? "Pesquisar produtos na Persi"
                : "O que você procura?"
          }
          aria-label="Pesquisar produtos"
          aria-autocomplete="list"
          aria-controls={resultsId}
          aria-expanded={isOpen}
          aria-activedescendant={
            isOpen && activeIndex >= 0
              ? `${resultsId}-option-${products[activeIndex].id}`
              : undefined
          }
          className={
            isDesktop
              ? "min-w-0 flex-1 px-5 py-0 text-sm text-slate-900 outline-none"
              : "min-w-0 flex-1 px-4 py-2 text-sm text-slate-900 outline-none"
          }
        />

        <button
          type="submit"
          aria-label={isLoading ? "Pesquisando produtos" : "Pesquisar"}
          className={
            isDesktop
              ? "flex items-center justify-center px-4 text-[#0c2d72] transition-colors hover:bg-slate-100 active:bg-slate-200"
              : "flex items-center justify-center px-4 text-[#0c2d72] transition-colors active:bg-slate-200"
          }
        >
          {isLoading ? (
            <LoaderCircle
              size={isDesktop ? 23 : 22}
              className="animate-spin text-[#0c2d72]"
              aria-hidden="true"
            />
          ) : (
            <Search size={isDesktop ? 23 : 22} aria-hidden="true" />
          )}
        </button>
      </form>

      {isSearchActive ? (
        <div
          ref={overlayRef}
          className="fixed inset-x-0 bottom-0 z-30 bg-black/60"
          aria-hidden="true"
          onPointerDown={closeSearch}
        />
      ) : null}

      {isOpen ? (
        <div
          id={resultsId}
          className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-[6px] border border-slate-200 bg-white text-slate-900 shadow-xl"
          role="listbox"
          aria-label="Sugestões de produtos"
        >
          {status === "loading" ? (
            <p className="px-4 py-3 text-sm text-slate-500">Pesquisando...</p>
          ) : null}
          {status === "error" ? (
            <p className="px-4 py-3 text-sm text-slate-600">
              Não foi possível pesquisar agora.
            </p>
          ) : null}
          {status === "success" && products.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-600">
              Nenhum produto encontrado.
            </p>
          ) : null}
          {status === "success" && products.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {products.map((product, index) => (
                <li
                  id={`${resultsId}-option-${product.id}`}
                  key={product.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? "bg-blue-50 ring-2 ring-inset ring-[#0c2d72]"
                      : ""
                  }
                >
                  <Link
                    href={getProductHref(product.slug)}
                    onClick={() => {
                      setIsOpen(false);
                      setIsFocused(false);
                      setActiveIndex(-1);
                    }}
                    className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0c2d72]"
                  >
                    <Image
                      src={product.image?.src || FALLBACK_IMAGE}
                      alt={product.image?.alt || product.name}
                      width={56}
                      height={56}
                      sizes="56px"
                      className="h-14 w-14 shrink-0 rounded-[6px] border border-slate-100 object-contain p-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-sm font-semibold text-slate-800">
                        {product.name}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="font-bold text-[#0c2d72]">
                          {formatCurrency(product.price, product.currencyCode)}
                        </span>
                        <span
                          className={
                            product.available
                              ? "text-emerald-700"
                              : "text-red-700"
                          }
                        >
                          {product.available ? "Disponível" : "Em falta"}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
