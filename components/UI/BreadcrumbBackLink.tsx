import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export interface BreadcrumbTrailItem {
  label: string;
  href: string;
}

interface BreadcrumbBackLinkProps {
  items: BreadcrumbTrailItem[];
}

/**
 * Trilha compacta de retorno para o breadcrumb no mobile: mostra as
 * últimas categorias do caminho (até 2) em vez da árvore completa. O
 * JSON-LD BreadcrumbList e o breadcrumb completo do desktop continuam
 * intactos — isso só reformata a apresentação mobile.
 */
export function BreadcrumbBackLink({ items }: BreadcrumbBackLinkProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex h-11 min-w-0 items-center gap-1 sm:hidden">
      <ChevronLeft className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      {items.map((item, index) => (
        <span key={item.href} className="flex h-full min-w-0 items-center gap-1">
          {index > 0 ? (
            <span aria-hidden="true" className="shrink-0 text-muted">
              ›
            </span>
          ) : null}
          <Link
            href={item.href}
            title={item.label}
            className={`tap-feedback flex h-full items-center truncate rounded-sm px-0.5 text-sm font-medium text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              index === items.length - 1 ? "min-w-0 flex-1" : "max-w-[40%] shrink"
            }`}
          >
            {item.label}
          </Link>
        </span>
      ))}
    </div>
  );
}
