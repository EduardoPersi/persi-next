import type { ReactNode } from "react";
import type { AccountSessionResult } from "@/lib/account/validation";
import { Header } from "@/components/Header/Header";
import { Container } from "@/components/UI/Container";

type InstitutionalPageLayoutProps = {
  title: string;
  children: ReactNode;
  accountSession?: AccountSessionResult;
  containerSize?: "md" | "lg";
  contentVariant?: "institutional" | "workspace";
};

export function InstitutionalPageLayout({
  title,
  children,
  accountSession,
  containerSize = "md",
  contentVariant = "institutional",
}: InstitutionalPageLayoutProps) {
  return (
    <>
      <Header initialAccountSession={accountSession} />
      <main className="py-5 sm:py-8 lg:py-10">
        <Container size={containerSize}>
          <article className="rounded-md border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8 sm:py-8">
            <h1 className="text-2xl font-bold text-primary-hover sm:text-3xl">
              {title}
            </h1>
            <div
              className={
                contentVariant === "institutional"
                  ? "institutional-content mt-7"
                  : "mt-7"
              }
            >
              {children}
            </div>
          </article>
        </Container>
      </main>
    </>
  );
}
