"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { MapPin, ShieldCheck, Store, Truck } from "lucide-react";
import { Button } from "@/components/UI/Button";
import type { ProductBrand } from "@/types/brand";
import type { Product } from "@/types/product";
import { BackInStockForm } from "./BackInStockForm";
import { ProductQuantity } from "./ProductQuantity";

interface ProductPurchasePanelProps {
  product: Product;
  brand?: ProductBrand;
  stockNotificationEnabled: boolean;
}

export function ProductPurchasePanel({
  product,
  brand,
  stockNotificationEnabled,
}: ProductPurchasePanelProps) {
  const [quantity, setQuantity] = useState(1);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [shippingMessage, setShippingMessage] = useState("");
  const regularPrice = product.regularPrice;
  const hasDiscount =
    regularPrice !== undefined && regularPrice > product.price;
  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: product.currencyCode,
  });

  function handleTemporaryPurchase() {
    setPurchaseMessage(
      "Integração com o carrinho será adicionada na próxima etapa.",
    );
  }

  function handleShippingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShippingMessage(
      "A integração de frete será adicionada posteriormente.",
    );
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex items-start justify-between gap-4">
        <h1 className="min-w-0 flex-1 text-2xl font-bold leading-tight text-[#0c2d72] sm:text-3xl">
          {product.name}
        </h1>
        {brand?.image && brand.permalink ? (
          <a
            href={brand.permalink}
            className="flex h-14 w-24 shrink-0 items-center justify-center rounded-[6px] border border-slate-200 bg-white p-2 transition-colors hover:border-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2 sm:h-16 sm:w-28"
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
        <p className="text-3xl font-bold text-[#0c2d72]">
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
        ) : null}
        {!product.pixPrice &&
        !product.installmentText &&
        product.commercialText ? (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {product.commercialText}
          </p>
        ) : null}
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

      {product.variations
        .filter(
          (variation) =>
            variation.name && (variation.options?.length ?? 0) > 0,
        )
        .map((variation) => (
        <div key={variation.id} className="mt-5">
          <label
            htmlFor={`variation-${variation.id}`}
            className="mb-2 block text-sm font-semibold text-slate-800"
          >
            {variation.name}
          </label>
          <select
            id={`variation-${variation.id}`}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20"
          >
            {(variation.options ?? []).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
        ))}

      <div className="mt-6">
        {product.available ? (
          <>
            <div className="flex items-end gap-3">
              <ProductQuantity
                value={quantity}
                max={product.stockQuantity}
                onChange={setQuantity}
                fullWidthOnMobile={false}
              />
              <Button
                variant="secondary"
                size="lg"
                className="h-[50px] min-w-0 flex-1 rounded-[6px] text-xl font-bold"
                onClick={handleTemporaryPurchase}
              >
                Adicionar ao carrinho
              </Button>
            </div>
            <p
              className="mt-2 text-sm text-slate-600"
              role="status"
              aria-live="polite"
            >
              {purchaseMessage}
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
            <h2 className="font-semibold text-[#0c2d72]">
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
    </div>
  );
}
