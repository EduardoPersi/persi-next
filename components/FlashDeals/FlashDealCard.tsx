import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { getProductPaymentInfo } from "@/lib/commerce/productPayment";
import { getProductHref } from "@/lib/routing/storefrontUrls";
import type { Product } from "@/types/product";
import { ProductCardAction } from "@/components/Product/ProductCardAction";
import { FreeShippingBadge } from "@/components/Product/FreeShippingBadge";

const FALLBACK_IMAGE = "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

function safeImage(source?: string) {
  if (!source) return FALLBACK_IMAGE;
  if (source.startsWith("/images/")) return source;
  try {
    const url = new URL(source);
    return url.protocol === "https:" && url.hostname === "loja.persimateriais.com.br"
      ? source
      : FALLBACK_IMAGE;
  } catch {
    return FALLBACK_IMAGE;
  }
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export function FlashDealCard({ product }: { product: Product }) {
  const href = getProductHref(product.slug);
  const payment = getProductPaymentInfo({
    currentPrice: product.price,
    isVariable: product.type === "variable",
  });
  const discount = product.regularPrice && product.regularPrice > product.price
    ? Math.round((1 - product.price / product.regularPrice) * 100)
    : 0;

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-orange-200 bg-white shadow-sm" role="listitem">
      <Link
        href={href}
        data-flash-deal-product
        data-product-id={product.sku || product.id}
        data-product-name={product.name}
        className="relative aspect-square overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Ver ${product.name}`}
      >
        <span className="absolute left-2 top-2 z-10 rounded-md bg-secondary px-2 py-1 text-[10px] font-bold text-white sm:text-xs">
          ⚡ Oferta do Dia
        </span>
        {discount > 0 ? (
          <span className="absolute right-2 top-2 z-10 rounded-md bg-emerald-700 px-2 py-1 text-xs font-bold text-white">-{discount}%</span>
        ) : null}
        {product.freeShipping ? <span className="absolute bottom-2 left-2 z-10"><FreeShippingBadge compact /></span> : null}
        <Image src={safeImage(product.image?.src)} alt={product.image?.alt || product.name} fill sizes="(min-width: 1280px) 16vw, (min-width: 768px) 25vw, 50vw" className="object-contain p-3" />
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <Link href={href} data-flash-deal-product data-product-id={product.sku || product.id} data-product-name={product.name} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <h3 className="line-clamp-2 min-h-9 text-xs font-semibold leading-[18px] text-foreground sm:text-sm">{product.name}</h3>
        </Link>
        <div className="mt-2 flex items-center gap-1 text-xs text-muted" aria-label={`${product.averageRating.toFixed(1)} de 5 estrelas, ${product.reviewCount} avaliações`}>
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
          <span>{product.averageRating.toFixed(1)} ({product.reviewCount})</span>
        </div>
        <div className="mt-auto pt-2">
          {product.regularPrice ? <p className="text-xs text-muted line-through">{money(product.regularPrice, product.currencyCode)}</p> : null}
          <p className="text-base font-bold text-primary">{money(product.price, product.currencyCode)}</p>
          <p className="text-sm font-bold text-emerald-700">{money(payment.pixPrice, product.currencyCode)} no Pix</p>
          <p className="text-[11px] text-muted">{money(product.price, product.currencyCode)} no boleto</p>
          <p className="mt-1 text-[11px] text-muted">ou {payment.installments}x de {money(payment.installmentValue, product.currencyCode)} sem juros</p>
          {product.stockQuantity !== undefined && product.stockQuantity > 0 ? (
            <p className="mt-2 text-xs font-semibold text-red-700">🔥 Restam poucas unidades</p>
          ) : null}
          <ProductCardAction productId={product.id} productType={product.type ?? "simple"} href={href} available={product.available} isPurchasable={product.isPurchasable ?? false} hasOptions={product.hasOptions ?? false} />
        </div>
      </div>
    </article>
  );
}
