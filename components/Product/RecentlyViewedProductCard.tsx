import Image from "next/image";
import Link from "next/link";

export interface RecentlyViewedProductData {
  id: number;
  slug: string;
  name: string;
  image?: {
    src: string;
    alt: string;
  };
  price: number;
  regularPrice?: number;
  pixPrice?: number;
  currencyCode: string;
  commercialText?: string;
}

interface RecentlyViewedProductCardProps {
  product: RecentlyViewedProductData;
}

function formatCurrency(value: number, currencyCode: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode,
  }).format(value);
}

export function RecentlyViewedProductCard({
  product,
}: RecentlyViewedProductCardProps) {
  return (
    <Link
      href={`/produto/${product.slug}`}
      className="grid h-full min-h-32 grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-[6px] border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
      aria-label={`Ver ${product.name}`}
    >
      <span className="flex aspect-square items-center justify-center overflow-hidden">
        {product.image ? (
          <Image
            src={product.image.src}
            alt={product.image.alt || product.name}
            width={88}
            height={88}
            sizes="88px"
            className="h-full w-full object-contain"
          />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-sm font-medium leading-5 text-slate-800">
          {product.name}
        </span>
        {product.pixPrice !== undefined ? (
          <span className="mt-2 block text-sm font-bold text-emerald-600">
            {formatCurrency(product.pixPrice, product.currencyCode)} no Pix
          </span>
        ) : null}
        <span className="mt-1 block text-sm font-semibold text-[#0c2d72]">
          {formatCurrency(product.price, product.currencyCode)}
        </span>
        {product.commercialText ? (
          <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-slate-500">
            {product.commercialText}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
