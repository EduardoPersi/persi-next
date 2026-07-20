import Link from "next/link";
import { Header } from "@/components/Header/Header";
import { Container } from "@/components/UI/Container";

export default function CategoryNotFound() {
  return (
    <>
      <Header />
      <main className="py-12">
        <Container>
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <h1 className="text-2xl font-bold text-[#0c2d72]">
              Categoria não encontrada
            </h1>
            <p className="mt-3 text-slate-600">
              A categoria informada não existe ou não está disponível.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[#ff6a00] px-5 font-semibold text-white"
            >
              Voltar para a Home
            </Link>
          </div>
        </Container>
      </main>
    </>
  );
}
