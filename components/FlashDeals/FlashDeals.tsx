import { Zap } from "lucide-react";
import type { FlashDealsContext } from "@/types/flash-deals";
import { getFlashDeals } from "@/services/woocommerce/flashDeals";
import { FlashDealCard } from "./FlashDealCard";
import { FlashDealsAnalytics } from "./FlashDealsAnalytics";
import { FlashDealsCarousel } from "./FlashDealsCarousel";
import { FlashDealsTimer } from "./FlashDealsTimer";

export async function FlashDeals({ context }: { context: FlashDealsContext }) {
  const result = await getFlashDeals(context).catch(() => undefined);
  if (!result?.products.length) return null;
  const promotionId = `flash-deals-${context.type}-${result.slot}`;

  return (
    <FlashDealsAnalytics promotionId={promotionId} promotionName="Ofertas Relâmpago">
      <section className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 sm:p-6" aria-labelledby={`${promotionId}-title`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Zap className="h-6 w-6 shrink-0 fill-[#ff6a00] text-[#ff6a00]" aria-hidden="true" />
            <h2 id={`${promotionId}-title`} className="text-xl font-bold text-[#0c2d72] sm:text-2xl">Ofertas Relâmpago</h2>
            <span className="hidden h-px flex-1 bg-orange-300 sm:block" aria-hidden="true" />
          </div>
          <FlashDealsTimer endsAt={result.endsAt} />
        </div>
        <FlashDealsCarousel>
          {result.products.map((product) => <FlashDealCard key={product.id} product={product} />)}
        </FlashDealsCarousel>
      </section>
    </FlashDealsAnalytics>
  );
}
