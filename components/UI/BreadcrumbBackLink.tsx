import Link from "next/link";
import { ChevronLeft } from "lucide-react";

interface BreadcrumbBackLinkProps {
  label: string;
  href: string;
}

/**
 * Link de retorno compacto para o breadcrumb no mobile: mostra apenas a
 * categoria-pai mais específica em vez da árvore completa. O JSON-LD
 * BreadcrumbList e o breadcrumb completo do desktop continuam intactos.
 */
export function BreadcrumbBackLink({ label, href }: BreadcrumbBackLinkProps) {
  return (
    <Link
      href={href}
      title={label}
      className="tap-feedback flex h-11 min-w-0 items-center gap-1 rounded-sm px-0.5 text-sm font-medium text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:hidden"
    >
      <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
