import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Heart } from "lucide-react";
import { CustomerWorkspacePage } from "@/components/Account/CustomerWorkspacePage";
import { getServerAccountSession } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Minhas listas | Persi Materiais",
  description: "Acesse suas listas pessoais na Persi Materiais.",
  robots: { index: false, follow: false },
};

export default async function CustomerListsPage() {
  const session = await getServerAccountSession();
  if (!session) redirect("/entrar");

  return (
    <CustomerWorkspacePage title="Minhas listas" session={session}>
      <section aria-labelledby="customer-list-favorites">
        <Link
          href="/favoritos"
          className="flex max-w-xl items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-50 text-secondary">
            <Heart aria-hidden="true" />
          </span>
          <span>
            <span id="customer-list-favorites" className="block font-bold text-primary-hover">
              Favoritos
            </span>
            <span className="mt-1 block text-sm text-muted">
              Consulte os produtos que você salvou.
            </span>
          </span>
        </Link>
      </section>
    </CustomerWorkspacePage>
  );
}
