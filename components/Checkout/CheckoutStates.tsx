"use client";

import Link from "next/link";
import { Button } from "@/components/UI/Button";

export function CheckoutLoading() {
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600"
      role="status"
      aria-live="polite"
    >
      Carregando seu pedido…
    </div>
  );
}

export function CheckoutError() {
  return (
    <section className="rounded-xl border border-red-200 bg-white p-8 text-center">
      <h2 className="text-xl text-[#0c2d72]">
        Não foi possível carregar seu pedido agora.
      </h2>
      <p className="mt-3 text-sm text-slate-600">
        Verifique sua conexão e tente novamente.
      </p>
      <Button
        className="mt-6"
        onClick={() => window.location.reload()}
      >
        Tentar novamente
      </Button>
    </section>
  );
}

export function CheckoutEmptyCart() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <h2 className="text-xl text-[#0c2d72]">Seu carrinho está vazio</h2>
      <p className="mt-3 text-sm text-slate-600">
        Adicione produtos antes de iniciar a finalização da compra.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-2 font-medium text-white hover:bg-primary-hover"
      >
        Voltar à loja
      </Link>
    </section>
  );
}
