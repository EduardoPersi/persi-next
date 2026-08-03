"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Container } from "@/components/UI/Container";

const HIDDEN_FULL_FOOTER_PREFIXES = ["/checkout"];

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
      <Container className="py-4 text-center text-[13px] leading-5 text-slate-500">
        <p>
          © 2016-2026 Persi Construções e Comércio Ltda. CNPJ:
          26.069.136/0001-41. Todos os direitos reservados.
        </p>
      </Container>
    </footer>
  );
}
