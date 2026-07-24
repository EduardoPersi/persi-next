"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  MapPin,
  ShieldCheck,
  Store,
  Truck,
} from "lucide-react";
import { Button } from "@/components/UI/Button";
import { useCart } from "@/hooks/useCart";
import {
  canAttributeOptionMatch,
  resolveSelectedVariation,
} from "@/lib/commerce/variation";
import { getProductPaymentInfo } from "@/lib/commerce/productPayment";
import type { ProductBrand } from "@/types/brand";
import type { Product } from "@/types/product";
import { BackInStockForm } from "./BackInStockForm";
import { BuyTogether } from "./BuyTogether";
import { ProductPaymentMethods } from "./ProductPaymentMethods";
import { ProductQuantity } from "./ProductQuantity";

interface ProductPurchasePanelProps {
  product: Product;
  brand?: ProductBrand;
  buyTogetherProducts?: Product[];
  stockNotificationEnabled: boolean;
}

export function ProductPurchasePanel({
  product,
  brand,
  buyTogetherProducts = [],
  stockNotificationEnabled,
}: ProductPurchasePanelProps) {
  const mainPurchaseButtonRef = useRef<HTMLButtonElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >({});
  const [shippingMessage, setShippingMessage] = useState("");
  const [showStickyPurchase, setShowStickyPurchase] = useState(false);
  const { addItem } = useCart();
  const variationAttributes = useMemo(
    () => product.attributes.filter((attribute) => attribute.hasVariations),
    [product.attributes],
  );
  const selectedVariation = useMemo(
    () => resolveSelectedVariation(product.variations, selectedAttributes),
    [product.variations, selectedAttributes],
  );
  const isVariable = product.type === "variable";
  const isSupportedType =
    product.type === undefined ||
    product.type === "simple" ||
    product.type === "variable";
  const variationSelectionMessage =
    isVariable && !selectedVariation
      ? "Selecione todas as opções do produto."
      : selectedVariation && !selectedVariation.inStock
        ? "Produto fora de estoque."
        : selectedVariation && !selectedVariation.purchasable
          ? "Esta combinação não está disponível."
          : "";
  const activePrice = selectedVariation?.price ?? product.price;
  const regularPrice =
    selectedVariation?.regularPrice ?? product.regularPrice;
  const hasDiscount =
    regularPrice !== undefined && regularPrice > activePrice;
  const payment = getProductPaymentInfo({
    currentPrice: activePrice,
    isVariable: isVariable && !selectedVariation,
  });
  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: product.currencyCode,
  });

  useEffect(() => {
    const purchaseButton = mainPurchaseButtonRef.current;
    if (!purchaseButton || !product.available) return;

    const observer = new IntersectionObserver(([entry]) => {
      const hasPassedAboveViewport =
        !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
      setShowStickyPurchase(hasPassedAboveViewport);
    });

    observer.observe(purchaseButton);
    return () => observer.disconnect();
  }, [product.available]);

  async function handlePurchase() {
    if (!isSupportedType) return;

    if (isVariable && !selectedVariation) {
      setPurchaseMessage("Selecione todas as opções do produto.");
      return;
    }

    if (
      selectedVariation &&
      (!selectedVariation.purchasable || !selectedVariation.inStock)
    ) {
      setPurchaseMessage("Esta combinação não está disponível.");
      return;
    }

    setIsAdding(true);
    setPurchaseMessage("");
    const result = await addItem(
      selectedVariation
        ? {
            productId: product.id,
            variationId: selectedVariation.id,
            quantity,
            variation: selectedVariation.attributes.map((attribute) => ({
              attribute: attribute.name,
              value: attribute.value,
            })),
          }
        : { productId: product.id, quantity },
    );
    setPurchaseMessage(result.message);
    setIsAdding(false);
  }

  function handleShippingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShippingMessage(
      "A integração de frete será adicionada posteriormente.",
    );
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <h1 className="min-w-0 flex-1 text-2xl font-bold leading-tight text-[#0c2d72] sm:text-3xl">
          {product.name}
        </h1>
        {brand?.image && brand.permalink ? (
          <a
            href={brand.permalink}
            className="flex h-12 w-20 shrink-0 items-center justify-center rounded-[6px] border border-slate-200 bg-white p-2 transition-colors hover:border-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2 sm:h-16 sm:w-28"
            aria-label={`Conhecer a marca ${brand.name}`}
            title={`Conhecer a marca ${brand.name}`}
          >
            <Image
              src={brand.image.src}
              alt={brand.image.alt || `Logo ${brand.name}`}
              width={112}
              height={64}
              sizes="(min-width: 640px) 112px, 96px"
              className="h-auto max-h-full w-auto max-w-full object-contain"
            />
          </a>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-slate-500">SKU: {product.sku}</p>

      <div className="mt-6 border-y border-slate-200 py-5">
        {hasDiscount ? (
          <p className="text-sm text-slate-500 line-through">
            {currencyFormatter.format(regularPrice)}
          </p>
        ) : null}
        <p className="mt-1 text-3xl font-bold text-emerald-700">
          {currencyFormatter.format(payment.pixPrice)}
          <span className="ml-2 text-sm font-semibold">no Pix</span>
        </p>
        {payment.installments === 1 ? (
          <p className="mt-2 text-sm font-medium leading-5 text-slate-600">
            ou {currencyFormatter.format(payment.currentPrice)} sem juros no
            cartão
          </p>
        ) : (
          <p className="mt-2 text-sm font-medium leading-5 text-slate-600">
            ou {currencyFormatter.format(payment.currentPrice)} em até{" "}
            {payment.installments}x de{" "}
            {currencyFormatter.format(payment.installmentValue)} sem juros no
            cartão
          </p>
        )}
        <ProductPaymentMethods
          payment={payment}
          currencyCode={product.currencyCode}
        />
      </div>

      <div className="mt-5">
        <p
          className={`text-sm font-semibold ${
            product.available ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {product.available
            ? product.stockQuantity !== undefined
              ? `Disponível — ${product.stockQuantity} unidades em estoque`
              : "Disponível"
            : "Em falta — consulte a disponibilidade"}
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          {product.shortDescription}
        </p>
      </div>

      {isVariable
        ? variationAttributes.map((attribute) => {
            const attributeName = attribute.taxonomy || attribute.name;

            return (
              <div key={attributeName} className="mt-5">
                <label
                  htmlFor={`variation-${attribute.id}`}
                  className="mb-2 block text-sm font-medium text-slate-800"
                >
                  {attribute.name} <span aria-hidden="true">*</span>
                </label>
                <select
                  id={`variation-${attribute.id}`}
                  required
                  value={selectedAttributes[attributeName] ?? ""}
                  onChange={(event) => {
                    setSelectedAttributes((current) => ({
                      ...current,
                      [attributeName]: event.target.value,
                    }));
                    setPurchaseMessage("");
                  }}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20"
                >
                  <option value="">
                    Selecionar {attribute.name.toLocaleLowerCase("pt-BR")}
                  </option>
                  {attribute.options.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={
                        !canAttributeOptionMatch(
                          product.variations,
                          selectedAttributes,
                          attributeName,
                          option.value,
                        )
                      }
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })
        : null}

      <div className="mt-6">
        {!isSupportedType ? (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Este produto possui uma configuração especial. Entre em contato
            para comprar.
          </p>
        ) : product.available ? (
          <>
            <div className="grid grid-cols-[minmax(96px,min(30%,140px))_minmax(0,1fr)] items-end gap-3">
              <ProductQuantity
                value={quantity}
                max={product.stockQuantity}
                onChange={setQuantity}
                compact
                fullWidthOnMobile={false}
              />
              <Button
                ref={mainPurchaseButtonRef}
                variant="secondary"
                size="lg"
                className="h-[50px] min-w-0 flex-1 rounded-[6px] text-xl font-medium"
                onClick={() => void handlePurchase()}
                disabled={
                  isAdding ||
                  (isVariable &&
                    (!selectedVariation ||
                      !selectedVariation.purchasable ||
                      !selectedVariation.inStock))
                }
              >
                {isAdding ? "Adicionando..." : "Adicionar ao carrinho"}
              </Button>
            </div>
            <p
              className="mt-2 text-sm text-slate-600"
              role="status"
              aria-live="polite"
            >
              {purchaseMessage || variationSelectionMessage}
            </p>
          </>
        ) : (
          <BackInStockForm
            productId={product.id}
            productName={product.name}
            productUrl={product.permalink}
            integrationEnabled={stockNotificationEnabled}
            requiresVariation={product.variations.length > 0}
          />
        )}
      </div>

      {buyTogetherProducts.length > 0 ? (
        <BuyTogether
          mainProduct={product}
          complementaryProducts={buyTogetherProducts}
        />
      ) : null}

      {product.available ? (
        <form
          className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"
          onSubmit={handleShippingSubmit}
        >
          <div className="flex items-center gap-2">
            <MapPin
              className="h-5 w-5 text-[#ff6a00]"
              aria-hidden="true"
            />
            <h2 className="font-bold text-[#0c2d72]">
              Calcular frete e prazo
            </h2>
          </div>
          <label
            htmlFor="shipping-postcode"
            className="mt-4 block text-sm font-medium text-slate-700"
          >
            CEP
          </label>
          <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
            <input
              id="shipping-postcode"
              name="postcode"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              className="box-border h-11 w-full min-w-0 rounded-[6px] border border-slate-200 bg-white px-4 text-sm leading-normal text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20 sm:flex-1"
            />
            <Button
              type="submit"
              variant="outline"
              className="box-border h-11 min-h-0 w-full rounded-[6px] sm:w-auto"
            >
              Calcular
            </Button>
          </div>
          <a
            href="https://buscacepinter.correios.com.br/app/endereco/index.php?t"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-medium text-[#ff6a00] underline underline-offset-2 hover:text-[#e85f00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a00] focus-visible:ring-offset-2"
            aria-label="Consultar meu CEP no site dos Correios"
          >
            Não sei o meu CEP
          </a>
          <p
            className="mt-2 text-sm text-slate-600"
            role="status"
            aria-live="polite"
          >
            {shippingMessage}
          </p>
        </form>
      ) : null}

      <ul className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
        <li className="flex items-center gap-2">
          <ShieldCheck
            className="h-5 w-5 shrink-0 text-[#ff6a00]"
            aria-hidden="true"
          />
          Compra segura
        </li>
        <li className="flex items-center gap-2">
          <Store
            className="h-5 w-5 shrink-0 text-[#ff6a00]"
            aria-hidden="true"
          />
          Retirada na loja
        </li>
        <li className="flex items-center gap-2">
          <Truck
            className="h-5 w-5 shrink-0 text-[#ff6a00]"
            aria-hidden="true"
          />
          Entrega para Jundiaí e região
        </li>
      </ul>

      {product.available ? (
        <div
          aria-hidden={!showStickyPurchase}
          inert={!showStickyPurchase}
          className={`fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur transition-[transform,opacity,visibility] duration-300 ease-out ${
            showStickyPurchase
              ? "visible translate-y-0 opacity-100"
              : "invisible translate-y-full opacity-0"
          }`}
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-4">
            <div className="hidden min-w-0 flex-1 md:block">
              <p className="line-clamp-1 text-sm font-semibold text-slate-800">
                {product.name}
              </p>
              <p className="mt-0.5 text-sm font-bold text-emerald-700">
                {currencyFormatter.format(payment.pixPrice)} no Pix
              </p>
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(96px,min(30%,140px))_minmax(0,1fr)] items-center gap-3 md:max-w-xl">
              <ProductQuantity
                value={quantity}
                max={product.stockQuantity}
                onChange={setQuantity}
                compact
                fullWidthOnMobile={false}
                showLabel={false}
              />
              <Button
                variant="secondary"
                size="lg"
                className="h-[50px] min-w-0 rounded-[6px] px-4 text-base font-medium sm:text-lg"
                onClick={() => void handlePurchase()}
                disabled={
                  isAdding ||
                  (isVariable &&
                    (!selectedVariation ||
                      !selectedVariation.purchasable ||
                      !selectedVariation.inStock))
                }
              >
                {isAdding ? "Adicionando..." : "Adicionar ao carrinho"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
