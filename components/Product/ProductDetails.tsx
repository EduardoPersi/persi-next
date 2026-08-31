import { WordPressContent } from "@/components/UI/WordPressContent";
import type { Product } from "@/types/product";

interface ProductDetailsProps {
  product: Product;
}

export function ProductDetails({ product }: ProductDetailsProps) {
  const specifications =
    product.specifications ??
    product.attributes
      .filter((attribute) => attribute.terms.length > 0)
      .map((attribute) => ({
        label: attribute.name,
        value: attribute.terms.map((term) => term.name).join(", "),
      }));

  return (
    <section className="mt-12 space-y-10">
      <div>
        <h2 className="text-2xl font-bold text-primary">
          Descrição do produto
        </h2>
        <WordPressContent
          html={product.descriptionHtml || product.shortDescriptionHtml}
          variant="storefront"
          className="mt-4"
        />
      </div>

      {specifications.length > 0 ? (
        <div>
          <h2 className="text-2xl font-bold text-primary">
            Especificações técnicas
          </h2>
          <dl className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            {specifications.map((specification, index) => (
              <div
                key={specification.label}
                className={`grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-6 ${
                  index % 2 === 0 ? "bg-slate-50" : "bg-white"
                }`}
              >
                <dt className="font-semibold text-foreground">
                  {specification.label}
                </dt>
                <dd className="text-foreground">{specification.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

    </section>
  );
}
