"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronRight, Grid3X3 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";
import { useMegaMenu } from "@/hooks/useMegaMenu";
import { flattenCategoryTree, type NavigationCategory } from "@/lib/navigation/CategoryTree";
import type { MegaMenuData } from "@/lib/navigation/types";
import { CategoryIcon } from "./CategoryIcon";

const PLACEHOLDER_IMAGE = "/images/placeholders/category-placeholder.svg";

const FEATURED_CATEGORY_RULES = [
  { label: "Elétrica", exactName: "eletrica", pattern: /eletric/ },
  { label: "Hidráulica", exactName: "hidraulica", pattern: /hidraul/ },
  { label: "Impermeabilizante", exactName: "impermeabilizante", pattern: /impermeabil/ },
] as const;

function normalizeCategoryName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function findFeaturedCategory(
  roots: readonly NavigationCategory[],
  categories: readonly NavigationCategory[],
  exactName: string,
  pattern: RegExp,
) {
  return (
    roots.find((category) => normalizeCategoryName(category.name) === exactName) ??
    categories.find((category) => normalizeCategoryName(category.name) === exactName) ??
    roots.find((category) => pattern.test(normalizeCategoryName(category.name))) ??
    categories.find((category) => pattern.test(normalizeCategoryName(category.name)))
  );
}

function NestedCategory({ category }: { category: NavigationCategory }) {
  return (
    <li className="group/nested relative">
      <Link href={category.href} className="tap-feedback flex min-h-9 items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-sm leading-5 text-[#1f2937] transition-colors hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]">
        <span>{category.name}{typeof category.count === "number" ? <span className="ml-1 text-xs text-[#6b7280]">({category.count})</span> : null}</span>
        {category.children.length ? <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      </Link>
      {category.children.length ? (
        <ul className="invisible absolute left-full top-0 z-40 min-w-60 translate-x-2 rounded-xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition duration-150 group-hover/nested:visible group-hover/nested:opacity-100 group-focus-within/nested:visible group-focus-within/nested:opacity-100">
          {category.children.map((child) => <NestedCategory key={child.id} category={child} />)}
        </ul>
      ) : null}
    </li>
  );
}

function CategoryGroups({ category }: { category: NavigationCategory }) {
  if (!category.children.length) {
    return <p className="text-sm text-[#1f2937]">Explore todos os produtos disponíveis nesta categoria.</p>;
  }

  return (
    <div className="columns-2 gap-x-8 xl:columns-3">
      {category.children.map((group) => (
        <section key={group.id} className="mb-6 break-inside-avoid">
          <Link href={group.href} className="tap-feedback block rounded-sm px-1 py-0.5 text-sm font-bold uppercase leading-5 text-[#071f5c] transition-colors hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]">
            {group.name}
          </Link>
          {group.children.length ? <ul className="mt-2">{group.children.map((child) => <NestedCategory key={child.id} category={child} />)}</ul> : null}
        </section>
      ))}
    </div>
  );
}

export function MegaMenuDesktop({ menu }: { menu: MegaMenuData }) {
  const searchParams = useSearchParams();
  const { openMenuId, setOpenMenuId, closeMenu } = useMegaMenu();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<NavigationCategory | undefined>(menu.categories[0]);
  const allCategories = flattenCategoryTree(menu.categories);
  const featuredCategories = FEATURED_CATEGORY_RULES.flatMap((rule) => {
    const category = findFeaturedCategory(
      menu.categories,
      allCategories,
      rule.exactName,
      rule.pattern,
    );
    return category ? [{ ...rule, category }] : [];
  });
  const searchTerm = (searchParams.get("q") || searchParams.get("categoria") || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(closeMenu, 160);
  }

  function open(id: number | "all", category?: NavigationCategory) {
    cancelClose();
    setSelectedCategory(category ?? selectedCategory ?? menu.categories[0]);
    setOpenMenuId(id);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLElement>, id: number | "all", category?: NavigationCategory) {
    if (event.key === "Escape") return closeMenu();
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open(id, category);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-category-rail] a")?.focus());
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const triggers = Array.from(document.querySelectorAll<HTMLElement>("[data-mega-trigger]"));
      const index = triggers.indexOf(event.currentTarget);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      triggers[(index + offset + triggers.length) % triggers.length]?.focus();
    }
  }

  if (!menu.categories.length) return null;
  const preview = selectedCategory ?? menu.categories[0];

  return (
    <div className="relative" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      <nav className="flex items-center" aria-label="Categorias de produtos">
        <button type="button" data-mega-trigger aria-expanded={openMenuId !== null} aria-controls="mega-menu-panel" onMouseEnter={() => open("all")} onFocus={() => open("all")} onKeyDown={(event) => handleTriggerKeyDown(event, "all")} className="tap-feedback-inverse flex min-h-12 items-center gap-2 border-r border-white/40 px-3 text-base font-semibold text-white transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white lg:px-4">
          <Grid3X3 className="h-5 w-5" aria-hidden="true" /> Todas as Categorias <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
        {featuredCategories.map(({ category, label }) => {
          const normalizedName = category.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          const highlighted = Boolean(searchTerm && normalizedName.includes(searchTerm));
          return <Link key={category.id} href={category.href} data-mega-trigger aria-expanded={openMenuId === category.id} aria-controls="mega-menu-panel" onMouseEnter={() => open(category.id, category)} onFocus={() => open(category.id, category)} onKeyDown={(event) => handleTriggerKeyDown(event, category.id, category)} className={`tap-feedback-inverse flex min-h-12 items-center gap-2 border-r border-white/40 px-3 text-base font-semibold text-white transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white lg:px-4 ${highlighted ? "bg-black/15 underline decoration-2 underline-offset-4" : ""}`}><CategoryIcon name={category.name} className="h-5 w-5" />{label}</Link>;
        })}
        <Link href="/promocoes" data-mega-trigger onKeyDown={(event) => handleTriggerKeyDown(event, "all")} className="tap-feedback-inverse flex min-h-12 items-center border-r border-white/40 px-3 text-base font-semibold text-white transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white lg:px-4">Promoções</Link>
      </nav>

      <div id="mega-menu-panel" aria-hidden={openMenuId === null} className={`absolute left-0 top-full z-30 w-[min(1360px,calc(100vw-2rem))] origin-top overflow-visible rounded-b-xl bg-white text-slate-900 shadow-2xl transition duration-200 ${openMenuId === null ? "invisible -translate-y-2 opacity-0" : "visible translate-y-0 opacity-100"}`} onKeyDown={(event) => { if (event.key === "Escape") closeMenu(); }}>
        <div className="grid min-h-[520px] grid-cols-[270px_minmax(0,1fr)_390px] overflow-visible rounded-b-xl">
          <aside data-category-rail className="overflow-hidden rounded-bl-xl bg-[#0c2d72] py-2 text-white">
            {menu.categories.map((category) => {
              const active = preview.id === category.id;
              return <Link key={category.id} href={category.href} onMouseEnter={() => setSelectedCategory(category)} onFocus={() => setSelectedCategory(category)} className={`flex min-h-14 items-center gap-3 px-5 py-3 text-base font-semibold text-white transition-colors ${active ? "bg-white !text-[#071f5c]" : "tap-feedback-inverse hover:bg-[#071f5c]"}`}><CategoryIcon name={category.name} className="h-5 w-5 shrink-0" /><span className="min-w-0 flex-1 truncate">{category.name}</span><ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>;
            })}
            <Link href="/busca" className="tap-feedback-inverse flex min-h-14 items-center gap-3 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-[#071f5c]"><Grid3X3 className="h-5 w-5" aria-hidden="true" />Todos os produtos</Link>
          </aside>

          <div className="min-w-0 px-8 py-9"><CategoryGroups category={preview} /></div>

          <aside className="p-7 pl-2">
            <div className="group relative h-full min-h-[450px] overflow-hidden rounded-xl bg-slate-200">
              <Image src={preview.image?.src || PLACEHOLDER_IMAGE} alt={preview.image?.alt || preview.name} fill sizes="390px" className="object-cover transition duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-7 text-white">
                <h3 className="text-2xl font-bold leading-tight">{preview.name}</h3>
                <p className="mt-3 line-clamp-4 text-sm leading-6 text-white/90">{preview.description || `Encontre produtos de ${preview.name} com qualidade e confiança na Persi Materiais.`}</p>
                <Link href={preview.href} className="tap-feedback-inverse mt-5 inline-flex min-h-11 items-center bg-[#0c2d72] px-5 text-sm font-bold uppercase text-white transition-colors hover:bg-[#071f5c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Conheça os produtos</Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
