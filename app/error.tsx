"use client";

import { useEffect } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[storefront-render-error]", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-primary-hover">
          Não foi possível carregar esta página
        </h1>
        <p className="mt-3 text-muted">
          Houve uma falha temporária ao consultar a loja. Você pode tentar novamente sem perder sua navegação.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary px-5 font-semibold text-white hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
            Tentar novamente
          </button>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary px-5 font-semibold text-primary hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Voltar
          </button>
        </div>
        {error.digest ? (
          <p className="mt-5 text-xs text-muted">Código: {error.digest}</p>
        ) : null}
      </section>
    </main>
  );
}
