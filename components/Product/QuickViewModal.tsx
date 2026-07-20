"use client";

import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/UI/Button";
import { useCart } from "@/hooks/useCart";
import type { Product } from "@/types/product";
import { ProductQuantity } from "./ProductQuantity";

interface QuickViewModalProps {
  productSlug: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export function QuickViewModal({
  productSlug,
  onClose,
  returnFocusRef,
}: QuickViewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [requestKey, setRequestKey] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [cartMessage, setCartMessage] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const { addItem } = useCart();

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/catalog/products/${encodeURIComponent(productSlug)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as { product?: Product };
      })
      .then((data) => {
        if (!data.product) throw new Error();
        setProduct(data.product);
        setStatus("success");
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setStatus("error");
        }
      });

    return () => controller.abort();
  }, [productSlug, requestKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusElement = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === lastElement
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusElement?.focus();
    };
  }, [onClose, returnFocusRef]);

  async function handleAddToCart() {
    if (!product) return;

    setIsAdding(true);
    setCartMessage("");
    const result = await addItem(product.id, quantity);
    setCartMessage(result.message);
    setIsAdding(false);

    if (result.success) onClose();
  }

  function retry() {
    setProduct(null);
    setStatus("loading");
    setRequestKey((current) => current + 1);
  }

  const hasDiscount =
    product?.regularPrice !== undefined &&
    product.regularPrice > product.price;
  const canAddDirectly =
    product?.available &&
    product.isPurchasable &&
    product.type === "simple" &&
    !product.hasOptions;
  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: product?.currencyCode ?? "BRL",
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-2 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-view-title"
        aria-describedby={
          status === "error" ? "quick-view-error" : undefined
        }
        className="relative grid max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[6px] bg-white shadow-xl lg:grid-cols-[45%_55%]"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Fechar visualização rápida"
          className="sticky right-3 top-3 z-20 ml-auto mr-3 mt-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-white text-slate-700 shadow-sm hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] lg:absolute"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {status === "loading" ? (
          <div
            className="col-span-full grid min-h-[28rem] animate-pulse gap-6 p-6 lg:grid-cols-2"
            role="status"
          >
            <h2 id="quick-view-title" className="sr-only">
              Visualização rápida
            </h2>
            <span className="sr-only">Carregando visualização rápida...</span>
            <div className="aspect-square rounded-[6px] bg-slate-100" />
            <div className="space-y-4 pt-8">
              <div className="h-8 w-4/5 rounded-[6px] bg-slate-100" />
              <div className="h-6 w-2/5 rounded-[6px] bg-slate-100" />
              <div className="h-12 w-full rounded-[6px] bg-slate-100" />
            </div>
          </div>
        ) : status === "error" || !product ? (
          <div className="col-span-full flex min-h-80 flex-col items-center justify-center p-8 text-center">
            <h2
              id="quick-view-title"
              className="text-xl font-semibold text-[#0c2d72]"
            >
              Visualização rápida
            </h2>
            <p id="quick-view-error" className="mt-3 text-slate-600">
              Não foi possível carregar os detalhes deste produto.
            </p>
            <Button className="mt-5" onClick={retry}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center bg-slate-50 p-5 sm:p-8">
              {product.image ? (
                <Image
                  src={product.image.src}
                  alt={product.image.alt || product.name}
                  width={560}
                  height={560}
                  sizes="(min-width: 1024px) 45vw, 90vw"
                  className="aspect-square h-auto w-full object-contain"
                />
              ) : null}
            </div>

            <div className="min-w-0 p-5 pt-2 sm:p-8 lg:pt-14">
              {product.brands[0]?.name ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {product.brands[0].name}
                </p>
              ) : null}
              <h2
                id="quick-view-title"
                className="mt-2 text-2xl font-bold leading-tight text-[#0c2d72]"
              >
                {product.name}
              </h2>

              <div className="mt-5 border-y border-slate-200 py-4">
                {hasDiscount ? (
                  <p className="text-sm text-slate-500 line-through">
                    {currencyFormatter.format(product.regularPrice!)}
                  </p>
                ) : null}
                <p className="text-2xl font-bold text-[#0c2d72]">
                  {currencyFormatter.format(product.price)}
                </p>
                {product.pixPrice !== undefined ? (
                  <p className="mt-1 font-semibold text-emerald-700">
                    {currencyFormatter.format(product.pixPrice)} no Pix
                  </p>
                ) : null}
                {product.installmentText ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {product.installmentText}
                  </p>
                ) : product.commercialText ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {product.commercialText}
                  </p>
                ) : null}
              </div>

              <p
                className={`mt-5 text-sm font-semibold ${
                  product.available ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {product.available ? "Disponível" : "Produto em falta"}
              </p>

              {canAddDirectly ? (
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <ProductQuantity
                    value={quantity}
                    max={product.stockQuantity}
                    onChange={setQuantity}
                  />
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={handleAddToCart}
                    disabled={isAdding}
                    className="h-[50px] min-h-[50px] w-full rounded-[6px] text-base sm:flex-1"
                  >
                    {isAdding ? "Adicionando..." : "Adicionar ao carrinho"}
                  </Button>
                </div>
              ) : (
                <Link
                  href={`/produto/${product.slug}`}
                  className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-[6px] bg-[#0c2d72] px-5 text-center font-semibold text-white transition-colors hover:bg-[#17439f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2"
                >
                  {product.available &&
                  (product.type === "variable" || product.hasOptions)
                    ? "Ver opções"
                    : "Ver produto"}
                </Link>
              )}

              <p
                className="mt-2 min-h-5 text-sm text-slate-600"
                role="status"
                aria-live="polite"
              >
                {cartMessage}
              </p>

              <Link
                href={`/produto/${product.slug}`}
                className="mt-3 inline-flex text-sm font-semibold text-[#0c2d72] underline underline-offset-4 hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
              >
                Ver detalhes do produto
              </Link>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
