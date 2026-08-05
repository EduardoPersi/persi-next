"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Container } from "@/components/UI/Container";

const HIDDEN_FULL_FOOTER_PREFIXES = ["/checkout"];

const PAYMENT_ICONS = [
  { file: "visa", label: "Visa" },
  { file: "elo", label: "Elo" },
  { file: "amex", label: "American Express" },
  { file: "mastercard", label: "Mastercard" },
  { file: "pix", label: "Pix" },
  { file: "boleto", label: "Boleto" },
] as const;

// Recebe o <Footer /> completo (renderizado no servidor) como children e só
// decide, no client, se ele deve aparecer — evita duplicar o Footer.tsx em
// duas variantes e mantém o rodapé de verdade como Server Component.
export function FooterVisibility({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideFullFooter = HIDDEN_FULL_FOOTER_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!hideFullFooter) return <>{children}</>;

  return (
    <footer className="border-t border-[#E5E7EB] bg-slate-50">
      <Container className="py-4 text-center">
        <h2 className="text-sm font-bold text-slate-800">Formas de pagamento</h2>
        <ul className="mx-auto mt-3 grid max-w-[224px] grid-cols-3 gap-1.5 sm:max-w-[256px] sm:grid-cols-6">
          {PAYMENT_ICONS.map((icon) => (
            <li
              key={icon.file}
              className="flex aspect-[10/7] items-center justify-center rounded-lg border border-slate-200 bg-white p-1"
            >
              <Image
                src={`/images/footer/${icon.file}.webp`}
                alt={icon.label}
                width={500}
                height={350}
                sizes="45px"
                className="h-auto w-full object-contain"
              />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] leading-5 text-slate-500">
          © 2016-2026 Persi Construções e Comércio Ltda. CNPJ:
          26.069.136/0001-41. Todos os direitos reservados.
        </p>
      </Container>
    </footer>
  );
}
