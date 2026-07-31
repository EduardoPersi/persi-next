"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/UI/Button";
import { useCart } from "@/hooks/useCart";
import type { BoughtTogetherItem } from "@/types/boughtTogether";
import type { Product } from "@/types/product";
import { getProductHref } from "@/lib/routing/storefrontUrls";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

interface FrequentlyBoughtTogetherProps {
  mainProduct: Product;
  items: BoughtTogetherItem[];
}

function formatCurrency(value: number, currencyCode: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode,
  }).format(value);
}

export function FrequentlyBoughtTogether({
  mainProduct,
  items,
}: FrequentlyBoughtTogetherProps) {
  const { addItem } = useCart();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [quantities, setQuantities] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      items.map((item) => [item.productId, item.suggestedQuantity]),
    ),
  );
  const [isAdding, setIsAdding] = useState(false);
  const [message, setMessage] = useState("");
  const availableItems = items.filter((item) => item.inStock && item.purchasable);
  const selectedItems = availableItems.filter((item) =>
    selectedIds.has(item.productId),
  );
  const total =
    mainProduct.price +
    availableItems.reduce(
      (sum, item) =>
        selectedIds.has(item.productId)
          ? sum + Number(item.price) * (quantities[item.productId] ?? 1)
          : sum,
      0,
  );
  const mainProductCanBeAdded =
    mainProduct.type === "simple" &&
    mainProduct.isPurchasable !== false &&
    !mainProduct.hasOptions;

  if (availableItems.length === 0) return null;

  function toggleItem(productId: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function updateQuantity(productId: number, quantity: number) {
    setQuantities((current) => ({
      ...current,
      [productId]: Math.min(999, Math.max(1, Math.trunc(quantity))),
    }));
  }

  async function addSelected() {
    if (!mainProductCanBeAdded) {
      document.querySelector<HTMLElement>("[id^='variation-']")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setMessage("Selecione as opções do produto principal antes de continuar.");
      return;
    }

    setIsAdding(true);
    setMessage("");
    const failures: string[] = [];
    const mainResult = await addItem(mainProduct.id, 1);

    if (!mainResult.success) failures.push(mainProduct.name);

    for (const item of selectedItems) {
      const result = await addItem(
        item.productId,
        quantities[item.productId] ?? item.suggestedQuantity,
      );
      if (!result.success) failures.push(item.name);
    }

    setMessage(
      failures.length
        ? `Não foi possível adicionar: ${failures.join(", ")}. Os demais itens foram adicionados.`
        : "Itens selecionados adicionados ao carrinho.",
    );
    setIsAdding(false);
  }

  return (
    <section className="mt-8" aria-labelledby="frequently-bought-title">
      <h2 id="frequently-bought-title" className="text-xl font-bold text-slate-900">
        Compre junto
      </h2>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex min-h-28 items-center justify-center gap-3 rounded-xl border border-slate-200 px-3 py-4 sm:gap-5">
          {[
            {
              id: mainProduct.id,
              name: mainProduct.name,
              slug: mainProduct.slug,
              src: mainProduct.image?.src ?? FALLBACK_IMAGE,
              alt: mainProduct.image?.alt ?? mainProduct.name,
            },
            ...availableItems.map((item) => ({
              id: item.productId,
              name: item.name,
              slug: item.slug,
              src: item.image?.src || FALLBACK_IMAGE,
              alt: item.image?.alt || item.name,
            })),
          ].map((product, index) => (
            <div key={product.id} className="contents">
              {index > 0 ? (
                <Plus
                  className="h-6 w-6 shrink-0 text-slate-800"
                  aria-hidden="true"
                />
              ) : null}
              <Link
                href={getProductHref(product.slug)}
                aria-label={`Ver ${product.name}`}
                className="relative h-16 min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
              >
                <Image
                  src={product.src}
                  alt={product.alt}
                  fill
                  sizes="(min-width: 640px) 110px, 80px"
                  className="object-contain"
                />
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-4 divide-y divide-slate-200 border-b border-slate-200">
          <div className="flex min-h-13 items-center gap-3 py-4">
            <input
              type="checkbox"
              checked
              disabled
              aria-label="Produto principal selecionado"
              className="h-4 w-4 shrink-0 accent-[#0c2d72]"
            />
            <p className="min-w-0 flex-1 text-center text-sm leading-5 text-slate-800">
              {mainProduct.name}{" "}
              <strong>
                {formatCurrency(mainProduct.price, mainProduct.currencyCode)}
              </strong>
            </p>
          </div>

          {availableItems.map((item) => {
            const isSelected = selectedIds.has(item.productId);
            const quantity =
              quantities[item.productId] ?? item.suggestedQuantity;

            return (
              <div
                key={item.productId}
                className={`flex min-h-13 items-center gap-3 py-3 ${
                  isSelected ? "bg-emerald-50/60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleItem(item.productId)}
                  aria-label={`Selecionar ${item.name}`}
                  className="h-4 w-4 shrink-0 accent-[#0c2d72]"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={item.href}
                    className="line-clamp-2 block text-center text-sm leading-5 text-slate-800 hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                  >
                    {item.name}{" "}
                    <strong>
                      {formatCurrency(Number(item.price), item.currencyCode)}
                    </strong>
                  </Link>
                  {isSelected ? (
                    <div
                      className="mt-2 flex justify-center"
                      role="group"
                      aria-label={`Quantidade de ${item.name}`}
                    >
                      <div className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() =>
                            updateQuantity(item.productId, quantity - 1)
                          }
                          disabled={quantity <= 1}
                          aria-label={`Diminuir quantidade de ${item.name}`}
                          className="flex h-full w-8 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:text-slate-300"
                        >
                          <Minus className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <span
                          className="flex h-full w-10 items-center justify-center border-x border-slate-200 text-sm font-semibold"
                          aria-live="polite"
                        >
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateQuantity(item.productId, quantity + 1)
                          }
                          disabled={quantity >= 999}
                          aria-label={`Aumentar quantidade de ${item.name}`}
                          className="flex h-full w-8 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:text-slate-300"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-[#ff6a00]"
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-sm text-slate-700">
              {selectedItems.length > 0 ? (
                <>
                  Compre os{" "}
                  <strong>
                    {1 +
                      selectedItems.reduce(
                        (sum, item) =>
                          sum + (quantities[item.productId] ?? 1),
                        0,
                      )}{" "}
                    itens
                  </strong>{" "}
                  por
                </>
              ) : (
                <>
                  Selecione até <strong>{availableItems.length} complementos</strong>
                </>
              )}
            </p>
            <p
              className="mt-1 text-3xl font-bold text-slate-900"
              aria-live="polite"
            >
              {formatCurrency(total, mainProduct.currencyCode)}
            </p>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void addSelected()}
            disabled={isAdding || selectedItems.length === 0}
            className="w-full border-[#ff6a00] text-[#ff6a00] hover:bg-[#ff6a00] hover:text-white sm:min-w-48"
          >
            {isAdding ? "Adicionando..." : "Comprar junto"}
          </Button>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-600" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
