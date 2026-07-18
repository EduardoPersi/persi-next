import { Header } from "@/components/Header/Header";
import { HeroBanner } from "@/components/HeroBanner/HeroBanner";

export default function Home() {
  return (
    <>
      <Header />

      <HeroBanner />

      <main className="mx-auto max-w-7xl px-4 py-10">
        <h1 className="text-3xl font-bold text-[#0c2d72]">
          Persi Materiais
        </h1>

        <p className="mt-3 text-slate-600">
          Nova loja em desenvolvimento — Revisão 0.1
        </p>
      </main>
    </>
  );
}