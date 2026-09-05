import Link from "next/link";
import { Fragment } from "react";
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
 * últimas categorias do caminho (até 2) em vez da árvore completa, no
 * formato "categoria anterior/categoria atual". O JSON-LD BreadcrumbList
 * e o breadcrumb completo do desktop continuam intactos — isso só
 * reformata a apresentação mobile.
 *
 * Separador e link ficam soltos como filhos diretos do flex (via
 * Fragment), não dentro de um <span> intermediário: um max-w-% aninhado
 * em dois níveis de flex resolve contra um container de largura
 * indeterminada e pode colapsar o rótulo a 1 caractere. Nenhum item tem
 * uma largura mínima/máxima artificial — ambos encolhem proporcionalmente
 * ao próprio conteúdo, então a caixa nunca fica maior que o texto truncado.
 */
export function BreadcrumbBackLink({ items }: BreadcrumbBackLinkProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex h-9 min-w-0 items-center gap-1 sm:hidden">
      <ChevronLeft className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      {items.map((item, index) => (
        <Fragment key={item.href}>
          {index > 0 ? (
            <span aria-hidden="true" className="shrink-0 text-muted">
              /
            </span>
          ) : null}
          <Link
            href={item.href}
            title={item.label}
            className={`tap-feedback block min-w-0 truncate rounded-sm px-0.5 text-sm font-medium text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              index === items.length - 1 ? "flex-1" : "shrink"
            }`}
          >
            {item.label}
          </Link>
        </Fragment>
      ))}
    </div>
  );
}
