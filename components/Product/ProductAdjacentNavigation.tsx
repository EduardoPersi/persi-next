import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Grid2X2 } from "lucide-react";
import type {
  AdjacentProductSummary,
  ProductNavigationData,
} from "@/types/productNavigation";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

function ProductPreview({
  direction,
  product,
}: {
  direction: "previous" | "next";
  product: AdjacentProductSummary;
}) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute right-0 top-full z-40 mt-2 flex w-72 translate-y-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left opacity-0 shadow-lg transition duration-200 motion-reduce:transform-none motion-reduce:transition-none group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
    >
      <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-white">
        <Image
          src={product.image?.src || FALLBACK_IMAGE}
          alt={product.image?.alt || product.name}
          fill
          sizes="64px"
          className="object-contain p-1"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-500">
          {direction === "previous" ? "Produto anterior" : "Próximo produto"}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm font-semibold leading-5 text-slate-900">
          {product.name}
        </span>
        <span className="mt-1 block text-sm font-bold text-emerald-700">
          {product.formattedPrice}
        </span>
        {!product.inStock ? (
          <span className="mt-0.5 block text-xs font-medium text-red-700">
            Fora de estoque
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function ProductAdjacentNavigation({
  data,
}: {
  data: ProductNavigationData;
}) {
  if (!data.previous || !data.next) return null;

  return (
    <nav
      aria-label="Navegação entre produtos"
      className="hidden shrink-0 items-center pb-2 lg:flex"
    >
      <div className="flex items-center gap-1">
        <span className="group relative">
          <Link
            href={data.previous.href}
            aria-label={`Produto anterior: ${data.previous.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-50 hover:text-[#ff6a00] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ProductPreview direction="previous" product={data.previous} />
        </span>

        {data.category ? (
          <Link
            href={data.category.href}
            aria-label={`Ver produtos da categoria ${data.category.name}`}
            title={`Ver todos os produtos de ${data.category.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-50 hover:text-[#ff6a00] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
          >
            <Grid2X2 className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}

        <span className="group relative">
          <Link
            href={data.next.href}
            aria-label={`Próximo produto: ${data.next.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-50 hover:text-[#ff6a00] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ProductPreview direction="next" product={data.next} />
        </span>
      </div>
    </nav>
  );
}
