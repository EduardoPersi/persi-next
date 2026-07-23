import Link from "next/link";
import type { ReactNode } from "react";
import { Header } from "@/components/Header/Header";
import { Container } from "@/components/UI/Container";

type InstitutionalPageLayoutProps = {
  title: string;
  modified?: string;
  children: ReactNode;
};

export function InstitutionalPageLayout({
  title,
  modified,
  children,
}: InstitutionalPageLayoutProps) {
  const formattedDate = modified
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(
        new Date(modified),
      )
    : null;

  return (
    <>
      <Header />
      <main className="py-5 sm:py-8 lg:py-10">
        <Container size="md">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <li>
                <Link href="/" className="hover:text-[#ff6a00]">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-slate-900">
                {title}
              </li>
            </ol>
          </nav>

          <article className="mt-5 rounded-md border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8 sm:py-8">
            <h1 className="text-2xl font-bold text-[#071f5c] sm:text-3xl">
              {title}
            </h1>
            {formattedDate ? (
              <p className="mt-2 text-xs text-slate-500">
                Última atualização: {formattedDate}
              </p>
            ) : null}
            <div className="institutional-content mt-7">{children}</div>
          </article>
        </Container>
      </main>
    </>
  );
}
