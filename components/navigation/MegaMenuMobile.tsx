"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { NavigationCategory } from "@/lib/navigation/CategoryTree";

function MobileCategory({ category, depth = 0, onNavigate }: { category: NavigationCategory; depth?: number; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <div className="flex min-h-12 items-stretch rounded-lg hover:bg-slate-100" style={{ paddingLeft: `${Math.min(depth, 4) * 12}px` }}>
        <Link href={category.href} onClick={onNavigate} className="flex min-w-0 flex-1 items-center px-3 py-3 font-semibold text-[#071f5c]">
          <span className="truncate">{category.name}</span>
          {typeof category.count === "number" ? <span className="ml-1 text-xs font-normal text-[#6b7280]">({category.count})</span> : null}
        </Link>
        {category.children.length ? <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={`${open ? "Recolher" : "Expandir"} ${category.name}`} className="flex w-12 items-center justify-center rounded-lg text-[#0c2d72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"><ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" /></button> : null}
      </div>
      {category.children.length && open ? <ul className="border-l border-slate-200 pl-1">{category.children.map((child) => <MobileCategory key={child.id} category={child} depth={depth + 1} onNavigate={onNavigate} />)}</ul> : null}
    </li>
  );
}

export function MegaMenuMobile({ categories, onNavigate }: { categories: NavigationCategory[]; onNavigate: () => void }) {
  if (!categories.length) return <p className="px-3 py-4 text-sm text-slate-500">Categorias temporariamente indisponíveis.</p>;
  return <nav aria-label="Categorias de produtos"><ul>{categories.map((category) => <MobileCategory key={category.id} category={category} onNavigate={onNavigate} />)}</ul></nav>;
}
