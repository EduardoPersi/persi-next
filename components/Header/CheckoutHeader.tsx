import Image from "next/image";
import Link from "next/link";
import { Lock } from "lucide-react";

// Cabeçalho reduzido, só para as páginas de checkout: sem menu de
// categorias, busca, wishlist, carrinho ou login — reduz distração durante
// a compra. O logo continua linkando para a home, então o cliente ainda
// consegue sair/voltar normalmente.
export function CheckoutHeader() {
  return (
    <header className="bg-[#0c2d72] text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href="/"
          aria-label="Ir para a página inicial da Persi Materiais"
          className="shrink-0"
        >
          <Image
            src="/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp"
            alt="Persi Materiais Elétricos, Hidráulicos e Ferramentas"
            width={110}
            height={45}
            priority
            className="h-auto w-[90px] max-w-full object-contain md:w-[110px]"
          />
        </Link>
        <span className="flex items-center gap-2 text-sm font-medium text-white/90">
          <Lock size={18} className="shrink-0" aria-hidden="true" />
          Ambiente seguro
        </span>
      </div>
    </header>
  );
}
