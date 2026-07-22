"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useCart } from "@/hooks/useCart";
import { getProductPaymentInfo } from "@/lib/commerce/productPayment";
import type { Product } from "@/types/product";
import { Button } from "@/components/UI/Button";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

interface BuyTogetherProps {
  mainProduct: Product;
  complementaryProducts: Product[];
}

function formatCurrency(value: number, currencyCode: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode,
  }).format(value);
}

export function BuyTogether({
  mainProduct,
  complementaryProducts,
}: BuyTogetherProps) {
  const { addItem } = useCart();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [message, setMessage] = useState("");
  const mainProductCanBeAdded =
    mainProduct.type === "simple" &&
    mainProduct.isPurchasable !== false &&
    !mainProduct.hasOptions;
  const selectedComplements = complementaryProducts.filter((product) =>
    selectedIds.has(product.id),
  );
  const total = useMemo(
    () =>
      mainProduct.price +
      complementaryProducts.reduce(
        (sum, product) =>
          selectedIds.has(product.id)
            ? sum + product.price * (quantities[product.id] ?? 1)
            : sum,
        0,
      ),
    [complementaryProducts, mainProduct.price, quantities, selectedIds],
  );
  const payment = getProductPaymentInfo({ currentPrice: total });
  const selectedItemCount =
    1 +
    selectedComplements.reduce(
      (sum, product) => sum + (quantities[product.id] ?? 1),
      0,
    );

  function toggleProduct(productId: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function updateQuantity(product: Product, quantity: number) {
    const maxQuantity = Math.min(999, product.stockQuantity ?? 999);
    setQuantities((current) => ({
      ...current,
      [product.id]: Math.min(
        maxQuantity,
        Math.max(1, Math.trunc(quantity)),
      ),
    }));
  }

  async function handleAddSelected() {
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
    const items = [mainProduct, ...selectedComplements];
    const failures: string[] = [];

    for (const item of items) {
      const result = await addItem(
        item.id,
        item.id === mainProduct.id ? 1 : (quantities[item.id] ?? 1),
      );
      if (!result.success) failures.push(item.name);
    }

    setMessage(
      failures.length > 0
        ? `Não foi possível adicionar: ${failures.join(", ")}. Os demais itens foram adicionados.`
        : "Itens selecionados adicionados ao carrinho.",
    );
    setIsAdding(false);
  }

  return (
    <section className="mt-8" aria-labelledby="buy-together-title">
      <h2 id="buy-together-title" className="text-xl font-bold text-slate-900">
        Compre junto
      </h2>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex min-h-28 items-center justify-center gap-3 rounded-xl border border-slate-200 px-3 py-4 sm:gap-5">
          {[mainProduct, ...complementaryProducts].map((product, index) => (
            <div key={product.id} className="contents">
              {index > 0 ? (
                <Plus className="h-6 w-6 shrink-0 text-slate-800" aria-hidden="true" />
              ) : null}
              <Link
                href={`/produto/${product.slug}`}
                aria-label={`Ver ${product.name}`}
                className="relative h-16 min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
              >
                <Image
                  src={product.image?.src || FALLBACK_IMAGE}
                  alt={product.image?.alt || product.name}
                  fill
                  sizes="(min-width: 640px) 110px, 80px"
                  className="object-contain"
                />
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-4 divide-y divide-slate-200 border-b border-slate-200">
          <div className="flex gap-3 py-4">
            <input
              type="checkbox"
              checked
              disabled
              aria-label="Produto principal selecionado"
              className="mt-1 h-4 w-4 shrink-0 accent-[#0c2d72]"
            />
            <p className="min-w-0 flex-1 text-center text-sm leading-5 text-slate-800">
              {mainProduct.name}{" "}
              <strong>{formatCurrency(mainProduct.price, mainProduct.currencyCode)}</strong>
            </p>
          </div>

          {complementaryProducts.map((product) => {
            const isSelected = selectedIds.has(product.id);
            const quantity = quantities[product.id] ?? 1;

            return (
            <div
              key={product.id}
              className={`flex items-center gap-3 py-4 ${
                isSelected ? "bg-emerald-50/60" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleProduct(product.id)}
                aria-label={`Selecionar ${product.name}`}
                className="h-4 w-4 shrink-0 accent-[#0c2d72]"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/produto/${product.slug}`}
                  className="line-clamp-2 text-center text-sm leading-5 text-slate-800 hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                >
                  {product.name}{" "}
                  <strong>{formatCurrency(product.price, product.currencyCode)}</strong>
                </Link>
                {isSelected ? (
                  <div
                    className="mt-2 flex justify-center"
                    role="group"
                    aria-label={`Quantidade de ${product.name}`}
                  >
                    <div className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white">
                      <button
                        type="button"
                        onClick={() => updateQuantity(product, quantity - 1)}
                        disabled={quantity <= 1}
                        aria-label={`Diminuir quantidade de ${product.name}`}
                        className="flex h-full w-8 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:text-slate-300"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={Math.min(999, product.stockQuantity ?? 999)}
                        step={1}
                        value={quantity}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => {
                          const nextQuantity = event.currentTarget.valueAsNumber;
                          if (Number.isFinite(nextQuantity)) {
                            updateQuantity(product, nextQuantity);
                          }
                        }}
                        aria-label={`Quantidade de ${product.name}`}
                        className="h-full w-12 appearance-none border-x border-slate-200 bg-white text-center text-sm font-semibold text-slate-900 outline-none focus:border-[#0c2d72] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity(product, quantity + 1)}
                        disabled={
                          quantity >= Math.min(999, product.stockQuantity ?? 999)
                        }
                        aria-label={`Aumentar quantidade de ${product.name}`}
                        className="flex h-full w-8 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:text-slate-300"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-[#ff6a00]" aria-hidden="true" />
            </div>
            );
          })}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-sm text-slate-700">
              {selectedComplements.length > 0 ? (
                <>Compre os <strong>{selectedItemCount} itens</strong> por</>
              ) : (
                <>Selecione até <strong>2 complementos</strong></>
              )}
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-900" aria-live="polite">
              {formatCurrency(payment.currentPrice, mainProduct.currencyCode)}
            </p>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void handleAddSelected()}
            disabled={isAdding || selectedComplements.length === 0}
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
