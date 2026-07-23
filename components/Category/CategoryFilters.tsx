"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { CatalogFilterData } from "@/types/catalog-filters";

export interface CategoryFilterValues {
  minPrice?: string;
  maxPrice?: string;
  availability?: string;
  promotion?: string;
  brand?: string;
  category?: string;
  subcategory?: string;
  order?: string;
  attributes?: Record<string, string>;
}

interface CategoryFiltersProps {
  pathname: string;
  values: CategoryFilterValues;
  filterData: CatalogFilterData;
  preservedParams?: Record<string, string>;
  mode?: "mobile" | "desktop" | "both";
}

interface FilterFormProps extends CategoryFiltersProps {
  onSubmit?: () => void;
}

function splitSelected(value?: string) {
  return new Set((value ?? "").split(",").filter(Boolean));
}

const COLOR_SWATCHES: Record<string, string> = {
  amarelo: "bg-[#fde047]",
  azul: "bg-[#0ea5e9]",
  branco: "bg-white",
  cinza: "bg-[#a3a3a3]",
  laranja: "bg-[#f97316]",
  marrom: "bg-[#92400e]",
  preto: "bg-[#171717]",
  verde: "bg-[#22c55e]",
  vermelho: "bg-[#ef4444]",
};

function FilterForm({
  pathname,
  values,
  filterData,
  preservedParams = {},
  onSubmit,
}: FilterFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [minPrice, setMinPrice] = useState(
    Number(values.minPrice ?? filterData.minPrice),
  );
  const [maxPrice, setMaxPrice] = useState(
    Number(values.maxPrice ?? filterData.maxPrice),
  );
  const [searches, setSearches] = useState<Record<string, string>>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const groupedValues = new Map<string, string[]>();

    data.forEach((value, key) => {
      const normalizedValue = String(value).trim();
      if (!normalizedValue) return;
      groupedValues.set(key, [
        ...(groupedValues.get(key) ?? []),
        normalizedValue,
      ]);
    });

    const params = new URLSearchParams();
    groupedValues.forEach((items, key) => {
      params.set(key, items.join(","));
    });
    params.delete("pagina");
    onSubmit?.();

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, {
        scroll: false,
      });
    });
  }

  function handleClear() {
    onSubmit?.();
    const params = new URLSearchParams(preservedParams);
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  }

  const selectedBrands = splitSelected(values.brand);
  const selectedCategories = splitSelected(values.category);
  const priceFloor = Math.floor(filterData.minPrice);
  const priceCeiling = Math.max(
    Math.ceil(filterData.maxPrice),
    priceFloor + 1,
  );
  const priceFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

  function getVisibleOptions(
    key: string,
    options: CatalogFilterData["brands"],
  ) {
    const search = searches[key]?.trim().toLocaleLowerCase("pt-BR") ?? "";
    return search
      ? options.filter((option) =>
          option.name.toLocaleLowerCase("pt-BR").includes(search),
        )
      : options;
  }

  return (
    <form action={pathname} method="get" onSubmit={handleSubmit}>
      {Object.entries(preservedParams).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {values.order ? (
        <input type="hidden" name="ordem" value={values.order} />
      ) : null}
      {values.subcategory ? (
        <input
          type="hidden"
          name="subcategoria"
          value={values.subcategory}
        />
      ) : null}

      <fieldset className="border-b border-slate-200 pb-7">
        <legend className="text-[13px] font-medium text-slate-900">
          Preço
        </legend>
        <div className="relative mt-4 h-5">
          <div className="absolute left-0 right-0 top-2 h-0.5 bg-[#0c2d72]" />
          <input
            name="preco_min"
            type="range"
            min={priceFloor}
            max={priceCeiling}
            value={minPrice}
            onChange={(event) =>
              setMinPrice(
                Math.min(Number(event.target.value), maxPrice - 1),
              )
            }
            className="pointer-events-none absolute inset-x-0 top-0 h-4 w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#0c2d72] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-[#0c2d72]"
            aria-label="Preço mínimo"
          />
          <input
            name="preco_max"
            type="range"
            min={priceFloor}
            max={priceCeiling}
            value={maxPrice}
            onChange={(event) =>
              setMaxPrice(
                Math.max(Number(event.target.value), minPrice + 1),
              )
            }
            className="pointer-events-none absolute inset-x-0 top-0 h-4 w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#0c2d72] [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-[#0c2d72]"
            aria-label="Preço máximo"
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Preço:{" "}
            <strong className="text-slate-800">
              {priceFormatter.format(minPrice)}
            </strong>{" "}
            —{" "}
            <strong className="text-slate-800">
              {priceFormatter.format(maxPrice)}
            </strong>
          </span>
          <button
            type="submit"
            disabled={isPending}
            className="h-8 rounded-[6px] bg-slate-50 px-3 text-[10px] font-medium uppercase text-slate-800 hover:bg-slate-100"
          >
            Filtrar
          </button>
        </div>
      </fieldset>

      {(filterData.categories?.length ?? 0) > 0 ? (
        <fieldset className="border-b border-slate-200 py-7">
          <legend className="text-[13px] font-medium text-slate-900">
            Categoria
          </legend>
          <div className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1">
            {filterData.categories?.map((category) => (
              <label
                key={category.id}
                className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[6px] px-1 text-sm text-slate-600 transition-colors hover:bg-slate-50 focus-within:ring-2 focus-within:ring-[#0c2d72]/20"
              >
                <input
                  type="checkbox"
                  name="categoria"
                  value={category.id}
                  defaultChecked={
                    selectedCategories.has(String(category.id)) ||
                    selectedCategories.has(category.slug)
                  }
                  onChange={(event) =>
                    event.currentTarget.form?.requestSubmit()
                  }
                  className="h-3.5 w-3.5 shrink-0 accent-[#0c2d72]"
                />
                <span className="min-w-0 flex-1 truncate">
                  {category.name}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] leading-none text-slate-400">
                  ({category.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {filterData.brands.length > 0 ? (
        <fieldset className="border-b border-slate-200 py-7">
          <legend className="text-[13px] font-medium text-slate-900">
            Marca
          </legend>
          <label className="relative mt-3 block">
            <span className="sr-only">Encontrar marca</span>
            <input
              type="search"
              value={searches.brand ?? ""}
              onChange={(event) =>
                setSearches((current) => ({
                  ...current,
                  brand: event.target.value,
                }))
              }
              placeholder="Encontre a Marca"
              className="h-10 w-full rounded-[6px] border border-slate-300 bg-white pl-3 pr-9 text-xs outline-none focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20"
            />
            <Search
              className="pointer-events-none absolute right-3 top-2.5 h-5 w-5 text-slate-900"
              aria-hidden="true"
            />
          </label>
          <div className="mt-4 max-h-44 space-y-1 overflow-y-auto pr-1">
            {getVisibleOptions("brand", filterData.brands).map((brand) => (
              <label
                key={brand.id}
                className="flex min-h-9 cursor-pointer items-center gap-3 rounded-[6px] px-1 text-sm text-slate-600 transition-colors hover:bg-slate-50 focus-within:ring-2 focus-within:ring-[#0c2d72]/20"
              >
                <input
                  type="checkbox"
                  name="marca"
                  value={brand.id}
                  defaultChecked={
                    selectedBrands.has(String(brand.id)) ||
                    selectedBrands.has(brand.slug)
                  }
                  onChange={(event) =>
                    event.currentTarget.form?.requestSubmit()
                  }
                  className="peer sr-only"
                />
                {brand.image ? (
                  <Image
                    src={brand.image.src}
                    alt={brand.image.alt}
                    width={44}
                    height={20}
                    className="h-5 w-11 shrink-0 object-contain"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate peer-checked:font-semibold peer-checked:text-[#0c2d72]">
                  {brand.name}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] leading-none text-slate-400">
                  ({brand.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {filterData.attributes.map((attribute) => {
        const selectedOptions = splitSelected(
          values.attributes?.[attribute.taxonomy],
        );

        return (
          <fieldset
            key={attribute.id}
            className="border-b border-slate-200 py-7"
          >
            <legend className="text-[13px] font-medium text-slate-900">
              {attribute.name}
            </legend>
            {attribute.taxonomy === "pa_cor" ||
            attribute.options.length > 5 ? (
              <label className="relative mt-3 block">
                <span className="sr-only">Encontrar {attribute.name}</span>
                <input
                  type="search"
                  value={searches[attribute.taxonomy] ?? ""}
                  onChange={(event) =>
                    setSearches((current) => ({
                      ...current,
                      [attribute.taxonomy]: event.target.value,
                    }))
                  }
                  placeholder={`Encontre ${attribute.name}`}
                  className="h-10 w-full rounded-[6px] border border-slate-300 bg-white pl-3 pr-9 text-xs outline-none focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20"
                />
                <Search
                  className="pointer-events-none absolute right-3 top-2.5 h-5 w-5 text-slate-900"
                  aria-hidden="true"
                />
              </label>
            ) : null}
            <div className="mt-4 max-h-44 space-y-1 overflow-y-auto pr-1">
              {getVisibleOptions(
                attribute.taxonomy,
                attribute.options,
              ).map((option) => (
                <label
                  key={option.id}
                  className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[6px] px-1 text-sm text-slate-600 transition-colors hover:bg-slate-50 focus-within:ring-2 focus-within:ring-[#0c2d72]/20"
                >
                  <input
                    type="checkbox"
                    name={`atributo_${attribute.taxonomy}`}
                    value={option.slug}
                    defaultChecked={selectedOptions.has(option.slug)}
                    onChange={(event) =>
                      event.currentTarget.form?.requestSubmit()
                    }
                    className={
                      attribute.taxonomy === "pa_cor"
                        ? "peer sr-only"
                        : "h-3.5 w-3.5 shrink-0 accent-[#0c2d72]"
                    }
                  />
                  {attribute.taxonomy === "pa_cor" ? (
                    <span
                      className={`h-4 w-4 shrink-0 rounded-full border border-slate-200 ${
                        COLOR_SWATCHES[option.slug] ?? "bg-slate-200"
                      }`}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate peer-checked:font-semibold peer-checked:text-[#0c2d72]">
                    {option.name}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] leading-none text-slate-400">
                    ({option.count})
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      <fieldset className="py-7">
        <legend className="text-[13px] font-medium text-slate-900">
          Status do estoque
        </legend>
        <div className="mt-3 space-y-2">
          {filterData.onSaleAvailable ? (
            <label className="flex min-h-7 cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="promocao"
                value="sim"
                defaultChecked={values.promotion === "sim"}
                onChange={(event) =>
                  event.currentTarget.form?.requestSubmit()
                }
                className="h-4 w-4 accent-[#0c2d72]"
              />
              Promoção
            </label>
          ) : null}
          {filterData.inStockCount > 0 ? (
            <label className="flex min-h-7 cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="estoque"
                value="disponivel"
                defaultChecked={values.availability === "disponivel"}
                onChange={(event) =>
                  event.currentTarget.form?.requestSubmit()
                }
                className="h-4 w-4 accent-[#0c2d72]"
              />
              <span className="flex-1">Em estoque</span>
              <span className="text-xs text-slate-400">
                ({filterData.inStockCount})
              </span>
            </label>
          ) : null}
        </div>
      </fieldset>

      <div className="pb-2">
        <button
          type="button"
          onClick={handleClear}
          disabled={isPending}
          className="text-xs font-medium text-[#0c2d72] underline underline-offset-2 hover:text-[#ff6a00]"
        >
          Limpar filtros
        </button>
      </div>
    </form>
  );
}

export function CategoryFilters(props: CategoryFiltersProps) {
  const { mode = "both" } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [isOpenButtonVisible, setIsOpenButtonVisible] = useState(true);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const floatingButtonRef = useRef<HTMLButtonElement>(null);
  const lastOpenButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mode === "desktop" || !openButtonRef.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsOpenButtonVisible(entry.isIntersecting);
    });

    observer.observe(openButtonRef.current);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        lastOpenButtonRef.current?.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
    lastOpenButtonRef.current?.focus({ preventScroll: true });
  }

  function openDrawer(button: HTMLButtonElement) {
    lastOpenButtonRef.current = button;
    setIsOpen(true);
  }

  return (
    <>
      {mode !== "desktop" ? (
        <button
          ref={openButtonRef}
          type="button"
          onClick={(event) => openDrawer(event.currentTarget)}
          aria-expanded={isOpen}
          aria-controls="category-filter-drawer"
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-[6px] border border-slate-200 bg-white px-4 text-sm font-medium text-[#0c2d72] lg:hidden"
        >
          <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          Filtros
        </button>
      ) : null}

      {mode !== "desktop" && !isOpenButtonVisible && !isOpen ? (
        <button
          ref={floatingButtonRef}
          type="button"
          onClick={(event) => openDrawer(event.currentTarget)}
          aria-label="Abrir filtros"
          aria-controls="category-filter-drawer"
          className="fixed left-0 top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-slate-200 bg-white/70 text-[#0c2d72] shadow-md transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] lg:hidden"
        >
          <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}

      {mode !== "mobile" ? (
        <aside
          className="hidden bg-white px-4 py-2 lg:block"
          aria-label="Filtros de produtos"
        >
          <h2 className="sr-only">Filtrar produtos</h2>
          <FilterForm {...props} />
        </aside>
      ) : null}

      {mode !== "desktop" && isOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50"
            onClick={closeDrawer}
            aria-label="Fechar filtros"
          />
          <aside
            id="category-filter-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-filter-title"
            className="absolute inset-y-0 left-0 w-[min(90vw,360px)] overflow-y-auto bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="category-filter-title"
                className="text-lg font-bold text-[#0c2d72]"
              >
                Filtrar produtos
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Fechar filtros"
                className="flex h-10 w-10 items-center justify-center rounded-[6px] text-slate-700 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5">
              <FilterForm
                {...props}
                onSubmit={closeDrawer}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
