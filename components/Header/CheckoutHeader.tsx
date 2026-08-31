import Image from "next/image";
import Link from "next/link";
import { Lock } from "lucide-react";

interface CheckoutHeaderProps {
  // Usado só na confirmação do pedido: nenhuma outra etapa do checkout deve
  // mudar esse layout sem pedido explícito (ver AGENTS.md sobre o Header).
  centered?: boolean;
}

// Cabeçalho reduzido, só para as páginas de checkout: sem menu de
// categorias, busca, wishlist, carrinho ou login — reduz distração durante
// a compra. O logo continua linkando para a home, então o cliente ainda
// consegue sair/voltar normalmente.
export function CheckoutHeader({ centered = false }: CheckoutHeaderProps) {
  return (
    <header className="bg-gradient-to-br from-primary to-primary-hover text-white">
      <div
        className={
          centered
            ? "mx-auto flex max-w-7xl items-center justify-center px-4 py-3 sm:px-6"
            : "mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6"
        }
      >
        <Link
          href="/"
          aria-label="Ir para a página inicial da Persi Materiais"
          className="shrink-0"
        >
          <Image
            src="/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas cabeçalho.webp"
            alt="Persi Materiais Elétricos, Hidráulicos e Ferramentas"
            width={110}
            height={42}
            priority
            className="h-auto w-[90px] max-w-full object-contain md:w-[110px]"
          />
        </Link>
        {centered ? null : (
          <span className="flex items-center gap-2 text-sm font-medium text-white/90">
            <Lock size={18} className="shrink-0" aria-hidden="true" />
            Compra segura
          </span>
        )}
      </div>
    </header>
  );
}
