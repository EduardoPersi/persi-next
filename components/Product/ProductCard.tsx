import Image from "next/image";
import Link from "next/link";
import type { ProductImage } from "@/types/product";
import { ProductCardAction } from "./ProductCardAction";
import { ProductCardActions } from "./ProductCardActions";

const PRODUCT_FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

const ALLOWED_IMAGE_HOSTS = new Set([
  "persimateriais.com.br",
  "www.persimateriais.com.br",
]);

function getProductImageSource(image: string): string {
  const normalizedImage = image.trim();

  if (normalizedImage.startsWith("/images/")) {
    return normalizedImage;
  }

  try {
    const url = new URL(normalizedImage);

    if (
      url.protocol === "https:" &&
      ALLOWED_IMAGE_HOSTS.has(url.hostname)
    ) {
      return normalizedImage;
    }
  } catch {
    return PRODUCT_FALLBACK_IMAGE;
  }

  return PRODUCT_FALLBACK_IMAGE;
}

function getOptionalProductImageSource(
  image: string | undefined,
): string | undefined {
  const normalizedImage = image?.trim();
  if (!normalizedImage) return undefined;

  if (normalizedImage.startsWith("/images/")) {
    return normalizedImage;
  }

  try {
    const url = new URL(normalizedImage);

    if (
      url.protocol === "https:" &&
      ALLOWED_IMAGE_HOSTS.has(url.hostname)
    ) {
      return normalizedImage;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function formatCurrency(value: number, currencyCode: string): string {
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

export type ProductCardProps = {
  name: string;
  image: string;
  images?: ProductImage[];
  href: string;
  price: number;
  regularPrice?: number;
  currencyCode?: string;
  commercialText?: string;
  brand?: string;
  badge?: string;
  available?: boolean;
  priority?: boolean;
  showAddToCart?: boolean;
  productId?: number;
  productSlug?: string;
  productType?: string;
  isPurchasable?: boolean;
  hasOptions?: boolean;
  showActions?: boolean;
};

export function ProductCard({
  name,
  image,
  images,
  href,
  price,
  regularPrice,
  currencyCode = "BRL",
  commercialText,
  brand,
  badge,
  available = true,
  priority = false,
  showAddToCart = false,
  productId,
  productSlug,
  productType = "simple",
  isPurchasable = false,
  hasOptions = false,
  showActions = true,
}: ProductCardProps) {
  const imageSrc = getProductImageSource(image);
  const secondaryImage = images?.[1];
  const secondaryImageSrc =
    secondaryImage?.src.trim() !== image.trim()
      ? getOptionalProductImageSource(secondaryImage?.src)
      : undefined;
  const hasDiscount =
    regularPrice !== undefined && regularPrice > price;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition duration-200 hover:-translate-y-1 hover:shadow-md">
      <Link
        href={href}
        className="product-card-image-link relative block aspect-square overflow-hidden bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-inset"
      >
        {badge ? (
          <span className="absolute left-2 top-2 z-10 rounded-md bg-[#ff6a00] px-2 py-1 text-xs font-semibold text-white">
            {badge}
          </span>
        ) : null}

        {!available ? (
          <span className="absolute right-2 top-2 z-10 rounded-md bg-slate-700 px-2 py-1 text-xs font-semibold text-white">
            Em falta
          </span>
        ) : null}

        <Image
          src={imageSrc}
          alt={name}
          width={480}
          height={480}
          sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
          priority={priority}
          className={`product-card-primary-image absolute inset-0 h-full w-full object-contain p-4 ${
            secondaryImageSrc ? "product-card-has-secondary-image" : ""
          } ${available ? "" : "product-card-image-unavailable"
          }`}
        />
        {secondaryImageSrc ? (
          <Image
            src={secondaryImageSrc}
            alt=""
            aria-hidden="true"
            width={480}
            height={480}
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
            className={`product-card-secondary-image absolute inset-0 h-full w-full object-contain p-4 ${
              available ? "" : "product-card-image-unavailable"
            }`}
          />
        ) : null}
      </Link>

      {showActions && productId && productSlug ? (
        <ProductCardActions
          productId={productId}
          productSlug={productSlug}
          productName={name}
        />
      ) : null}

      <div className="flex flex-1 flex-col p-4">
        {brand ? (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {brand}
          </p>
        ) : null}

        <Link
          href={href}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2"
        >
          <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-800 transition-colors group-hover:text-[#ff6a00] md:min-h-12 md:text-base md:leading-6">
            {name}
          </h3>
        </Link>

        <div className="mt-auto pt-3">
          {hasDiscount ? (
            <p className="text-xs text-slate-500 line-through">
              {formatCurrency(regularPrice, currencyCode)}
            </p>
          ) : (
            <div className="h-4" aria-hidden="true" />
          )}

          <p className="text-lg font-bold text-[#0c2d72]">
            {formatCurrency(price, currencyCode)}
          </p>
          {commercialText ? (
            <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">
              {commercialText}
            </p>
          ) : (
            <div className="min-h-8" aria-hidden="true" />
          )}
          {showAddToCart && productId ? (
            <ProductCardAction
              productId={productId}
              productType={productType}
              href={href}
              available={available}
              isPurchasable={isPurchasable}
              hasOptions={hasOptions}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
