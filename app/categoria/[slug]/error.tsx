"use client";

import { Header } from "@/components/Header/Header";
import { Container } from "@/components/UI/Container";

interface CategoryErrorProps {
  reset: () => void;
}

export default function CategoryError({ reset }: CategoryErrorProps) {
  return (
    <>
      <Header />
      <main className="py-12">
        <Container>
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <h1 className="text-2xl font-bold text-[#0c2d72]">
              Não foi possível carregar esta categoria
            </h1>
            <p className="mt-3 text-slate-600">
              O catálogo está temporariamente indisponível. Tente novamente.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-6 h-11 rounded-xl bg-[#ff6a00] px-5 font-medium text-white"
            >
              Tentar novamente
            </button>
          </div>
        </Container>
      </main>
    </>
  );
}
