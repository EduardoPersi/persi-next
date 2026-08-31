"use client";

import Link from "next/link";
import { ChevronDown, Grid3X3 } from "lucide-react";
import { useState } from "react";
import type { NavigationCategory } from "@/lib/navigation/CategoryTree";

function MobileCategory({ category, depth = 0, onNavigate }: { category: NavigationCategory; depth?: number; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <div className="tap-feedback flex min-h-12 items-stretch rounded-lg transition-colors hover:bg-slate-100" style={{ paddingLeft: `${Math.min(depth, 4) * 12}px` }}>
        <Link href={category.href} onClick={onNavigate} className="flex min-w-0 flex-1 items-center px-3 py-3 font-semibold text-primary-hover">
          <span className="truncate">{category.name}</span>
        </Link>
        {category.children.length ? <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={`${open ? "Recolher" : "Expandir"} ${category.name}`} className="tap-feedback flex w-12 items-center justify-center rounded-lg text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" /></button> : null}
      </div>
      {category.children.length ? (
        <div className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <ul className="min-h-0 overflow-hidden border-l border-slate-200 pl-1">
            {category.children.map((child) => <MobileCategory key={child.id} category={child} depth={depth + 1} onNavigate={onNavigate} />)}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function MegaMenuMobile({ categories, onNavigate }: { categories: NavigationCategory[]; onNavigate: () => void }) {
  if (!categories.length) return <p className="px-3 py-4 text-sm text-muted">Categorias temporariamente indisponíveis.</p>;
  return <nav aria-label="Categorias de produtos" data-route-transition-skip><ul>{categories.map((category) => <MobileCategory key={category.id} category={category} onNavigate={onNavigate} />)}<li><Link href="/loja" onClick={onNavigate} className="tap-feedback flex min-h-12 items-center gap-3 rounded-lg px-3 py-3 font-semibold text-primary-hover transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Grid3X3 className="h-5 w-5" aria-hidden="true" />Todos os produtos</Link></li></ul></nav>;
}
