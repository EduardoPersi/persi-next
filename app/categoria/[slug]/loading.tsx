import { Header } from "@/components/Header/Header";
import { ProductGridSkeleton } from "@/components/Product/ProductGridSkeleton";
import { Container } from "@/components/UI/Container";

export default function CategoryLoading() {
  return (
    <>
      <Header />
      <main className="py-8">
        <Container>
          <div className="h-5 w-48 animate-pulse rounded-md bg-slate-200" />
          <div className="mt-6 h-48 animate-pulse rounded-xl bg-white" />
          <div className="mt-8">
            <ProductGridSkeleton />
          </div>
        </Container>
      </main>
    </>
  );
}
