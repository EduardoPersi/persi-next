import Link from "next/link";

import { getPimQueueCounts } from "@/lib/pim/repository";

export default async function PimReviewPage() {
  const counts = await getPimQueueCounts();
  const queues = [
    ["Needs Enrichment", "/admin/products?status=needs_enrichment", counts.needsEnrichment],
    ["Draft", "/admin/products?status=draft", counts.draft],
    ["Needs Review", "/admin/products?issue=needs_review", counts.needsReview],
    ["Rejected", "/admin/products?status=rejected", counts.rejected],
    ["AI Suggested", "/admin/products?status=ai_suggested", counts.aiSuggested],
    ["Ambiguous", "/admin/products?issue=ambiguous", counts.ambiguous],
    ["Unmapped", "/admin/products?issue=unmapped", counts.unmapped],
    ["Missing Data", "/admin/products?issue=missing", counts.missingData],
    ["Ready for Approval", "/admin/products?status=needs_enrichment", counts.readyForApproval],
    ["Approved", "/admin/products?status=approved", counts.approved],
  ] as const;

  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-[#ff6a00]">
        PIM review queue
      </p>
      <h1 className="text-2xl font-bold text-[#071f5c]">Fila de revisão</h1>
      <p className="mt-2 text-slate-600">
        Escolha uma fila operacional. Nenhuma aprovação em massa é executada nesta fase.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {queues.map(([label, href, count]) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border bg-white p-5 text-[#0c2d72] shadow-sm hover:border-blue-300"
          >
            <span className="block font-semibold">{label}</span>
            <span
              className="mt-2 block text-2xl font-bold"
              aria-label={`${count.toLocaleString("pt-BR")} produtos`}
            >
              {count.toLocaleString("pt-BR")}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
