"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
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

interface ProductSearchProps {
  variant: "desktop" | "mobile";
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

export function ProductSearch({ variant }: ProductSearchProps) {
  const router = useRouter();
  const resultsId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductSearchSuggestion[]>([]);
  const [status, setStatus] = useState<SuggestionsStatus>("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const trimmedQuery = query.trim();
  const canSuggest = trimmedQuery.length >= MINIMUM_QUERY_LENGTH;
  const isSearchActive = (isFocused && Boolean(trimmedQuery)) || isOpen;

  useEffect(() => {
    if (!canSuggest) return;

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
  }, [canSuggest, trimmedQuery]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setIsFocused(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!isSearchActive) return;

    const header = containerRef.current?.closest("header");
    const overlay = overlayRef.current;
    if (!header || !overlay) return;

    function updateOverlayTop() {
      const currentHeader = containerRef.current?.closest("header");
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

    setIsOpen(false);
    setIsFocused(false);
    router.push(`/busca?q=${encodeURIComponent(trimmedQuery)}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      setIsFocused(false);
      event.currentTarget.blur();
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);

    if (value.trim().length < MINIMUM_QUERY_LENGTH) {
      setProducts([]);
      setStatus("idle");
      setIsOpen(false);
    }
  }

  const isDesktop = variant === "desktop";

  return (
    <div
      ref={containerRef}
      className={
        isDesktop
          ? "relative hidden flex-1 md:block"
          : "relative mt-3 md:hidden"
      }
    >
      <form
        className="flex overflow-hidden rounded-md bg-white"
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
              : "O que você está procurando?"
          }
          aria-label="Pesquisar produtos"
          aria-autocomplete="list"
          aria-controls={resultsId}
          aria-expanded={isOpen}
          className={
            isDesktop
              ? "min-w-0 flex-1 px-5 py-3 text-sm text-slate-900 outline-none"
              : "min-w-0 flex-1 px-4 py-2 text-sm text-slate-900 outline-none"
          }
        />

        <button
          type="submit"
          aria-label="Pesquisar"
          className={
            isDesktop
              ? "flex items-center justify-center px-4 text-[#0c2d72] transition hover:bg-slate-100"
              : "flex items-center justify-center px-4 text-[#0c2d72]"
          }
        >
          <Search size={isDesktop ? 23 : 22} />
        </button>
      </form>

      {isSearchActive ? (
        <div
          ref={overlayRef}
          className="fixed inset-x-0 bottom-0 z-30 bg-black/60"
          aria-hidden="true"
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
              {products.map((product) => (
                <li key={product.id} role="option" aria-selected="false">
                  <Link
                    href={`/produto/${product.slug}`}
                    onClick={() => {
                      setIsOpen(false);
                      setIsFocused(false);
                    }}
                    className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0c2d72]"
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
