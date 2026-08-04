"use client";

import Image from "next/image";
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
      <Container className="py-4 text-center">
        <h2 className="text-sm font-bold text-slate-800">Formas de pagamento</h2>
        {/* Mesma imagem já usada no rodapé completo (components/Footer/Footer.tsx)
            — evita recriar logos de bandeiras/marcas registradas do zero. */}
        <Image
          src="/images/footer/pagamentos.webp"
          alt="Formas de pagamento aceitas pela Persi Materiais"
          width={295}
          height={82}
          sizes="230px"
          className="mx-auto mt-2 h-auto w-full max-w-[230px] object-contain"
        />
        <p className="mt-3 text-[13px] leading-5 text-slate-500">
          © 2016-2026 Persi Construções e Comércio Ltda. CNPJ:
          26.069.136/0001-41. Todos os direitos reservados.
        </p>
      </Container>
    </footer>
  );
}
