"use client";

import { ChevronDown, FileText, Table2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { WordPressContent } from "@/components/UI/WordPressContent";
import type { Product } from "@/types/product";

interface ProductDetailsProps {
  product: Product;
}

// Altura máxima do conteúdo antes de exibir "Ver detalhes"/"Ver ficha
// técnica": evita que uma descrição muito longa domine a página mesmo
// com a seção aberta.
const CLAMP_HEIGHT_PX = 420;

interface AccordionSectionProps {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  expandLabel: string;
  children: ReactNode;
}

function AccordionSection({
  icon,
  iconClassName,
  title,
  expandLabel,
  children,
}: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const content = contentRef.current;
    if (!content) return;
    setIsClamped(content.scrollHeight > CLAMP_HEIGHT_PX + 1);
  }, [isOpen]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClassName}`}
        >
          {icon}
        </span>
        <span className="flex-1 text-base font-bold text-primary sm:text-lg">
          {title}
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div className="border-t border-slate-200 px-5 pb-5 pt-4">
          <div
            ref={contentRef}
            className="overflow-hidden"
            style={
              isClamped && !isExpanded
                ? { maxHeight: CLAMP_HEIGHT_PX }
                : undefined
            }
          >
            {children}
          </div>
          {isClamped && !isExpanded ? (
            <div className="relative -mt-12 flex justify-center bg-gradient-to-t from-white via-white pt-12">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="flex items-center gap-1 rounded-sm text-sm font-semibold text-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {expandLabel}
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProductDetails({ product }: ProductDetailsProps) {
  const specifications =
    product.specifications ??
    product.attributes
      .filter((attribute) => attribute.terms.length > 0)
      .map((attribute) => ({
        label: attribute.name,
        value: attribute.terms.map((term) => term.name).join(", "),
      }));

  return (
    <section className="mt-12 space-y-4">
      <AccordionSection
        icon={<FileText className="h-4 w-4 text-white" aria-hidden="true" />}
        iconClassName="bg-secondary"
        title="Descrição do produto"
        expandLabel="Ver detalhes"
      >
        <WordPressContent
          html={product.descriptionHtml || product.shortDescriptionHtml}
          variant="storefront"
        />
      </AccordionSection>

      {specifications.length > 0 ? (
        <AccordionSection
          icon={<Table2 className="h-4 w-4 text-white" aria-hidden="true" />}
          iconClassName="bg-primary"
          title="Ficha Técnica"
          expandLabel="Ver ficha técnica"
        >
          <dl className="overflow-hidden rounded-xl border border-slate-200">
            {specifications.map((specification, index) => (
              <div
                key={specification.label}
                className={`grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-6 ${
                  index % 2 === 0 ? "bg-slate-50" : "bg-white"
                }`}
              >
                <dt className="font-semibold text-foreground">
                  {specification.label}
                </dt>
                <dd className="text-foreground">{specification.value}</dd>
              </div>
            ))}
          </dl>
        </AccordionSection>
      ) : null}
    </section>
  );
}
