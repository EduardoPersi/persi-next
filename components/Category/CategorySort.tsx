"use client";

import { useRouter } from "next/navigation";
import {
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from "react";

interface CategorySortProps {
  pathname: string;
  currentOrder: string;
  preservedParams: Record<string, string>;
  showRelevance?: boolean;
}

const orderOptions = [
  { value: "recentes", label: "Mais recentes" },
  { value: "menor-preco", label: "Menor preço" },
  { value: "maior-preco", label: "Maior preço" },
  { value: "mais-vendidos", label: "Mais vendidos" },
  { value: "nome-az", label: "Nome A-Z" },
];

export function CategorySort({
  pathname,
  currentOrder,
  preservedParams,
  showRelevance = false,
}: CategorySortProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();

    new FormData(event.currentTarget).forEach((value, key) => {
      const normalizedValue = String(value).trim();
      if (normalizedValue) params.set(key, normalizedValue);
    });
    params.delete("pagina");

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, {
        scroll: false,
      });
    });
  }

  function handleOrderChange(event: ChangeEvent<HTMLSelectElement>) {
    if (window.matchMedia("(max-width: 639px)").matches) {
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      action={pathname}
      method="get"
      onSubmit={handleSubmit}
      className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial"
    >
      {Object.entries(preservedParams).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="category-order" className="sr-only">
        Ordenar produtos
      </label>
      <select
        id="category-order"
        name="ordem"
        defaultValue={currentOrder}
        onChange={handleOrderChange}
        className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20 sm:min-w-48"
      >
        {[
          ...(showRelevance
            ? [{ value: "relevancia", label: "Mais relevantes" }]
            : []),
          ...orderOptions,
        ].map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="hidden h-11 rounded-xl border border-[#0c2d72] px-4 text-sm font-semibold text-[#0c2d72] transition-colors hover:bg-[#0c2d72] hover:text-white sm:inline-flex sm:items-center sm:justify-center"
      >
        {isPending ? "Ordenando..." : "Ordenar"}
      </button>
    </form>
  );
}
