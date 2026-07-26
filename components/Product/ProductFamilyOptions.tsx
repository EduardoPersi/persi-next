import Link from "next/link";
import type { ProductFamilyResponse } from "@/types/productFamily";

const attributeOptionCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export function ProductFamilyOptions({ data }: { data: ProductFamilyResponse }) {
  const attribute = data.family.attributes[0];
  if (!attribute) return null;

  const items = data.items
    .filter((item) => item.attributes[attribute.taxonomy])
    .sort((first, second) => {
      const firstLabel = first.attributes[attribute.taxonomy].label;
      const secondLabel = second.attributes[attribute.taxonomy].label;

      return (
        attributeOptionCollator.compare(firstLabel, secondLabel) ||
        first.productId - second.productId
      );
    });
  if (items.length < 2) return null;

  return (
    <section
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
      aria-labelledby="product-family-label"
    >
      <h2
        id="product-family-label"
        className="text-sm font-semibold text-slate-900"
      >
        {attribute.label}:
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const label = item.attributes[attribute.taxonomy].label;
          const classes =
            "inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border bg-white px-1.5 text-xs font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2";

          if (item.isCurrent) {
            return (
              <span
                key={item.productId}
                aria-current="page"
                className={`${classes} border-2 border-slate-900 text-slate-900`}
              >
                {label}
              </span>
            );
          }

          return (
            <Link
              key={item.productId}
              href={item.href}
              prefetch={false}
              aria-label={`${label}${item.inStock ? "" : " — fora de estoque"}`}
              className={`${classes} border-slate-200 text-slate-900 hover:border-[#ff6a00] hover:text-[#ff6a00] ${
                item.inStock ? "" : "text-slate-500 opacity-60"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
