import { AlertCircle } from "lucide-react";
import clsx from "clsx";

interface CheckoutErrorMessageProps {
  message: string;
  id?: string;
  live?: "polite" | "assertive";
  // Mantém o nó de aria-live sempre montado (mesmo sem mensagem) para que
  // atualizações "polite" no mesmo lugar sejam anunciadas — erros
  // "assertive" (ex.: cartão recusado) não precisam disso: montar/desmontar
  // o elemento já é suficiente para o leitor de tela anunciar o alerta.
  alwaysRender?: boolean;
  className?: string;
}

// Estilo de erro único do checkout — reaproveita a mesma paleta já usada em
// PixPaymentResult/CheckoutIdentityGate (border-red-200/bg-red-50/text-red-700)
// em vez de inventar uma nova.
export function CheckoutErrorMessage({
  message,
  id,
  live = "polite",
  alwaysRender = false,
  className,
}: CheckoutErrorMessageProps) {
  if (!message && !alwaysRender) return null;

  return (
    <p
      id={id}
      role={live === "assertive" ? "alert" : "status"}
      aria-live={live}
      className={clsx(
        message
          ? "flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          : "sr-only",
        className,
      )}
    >
      {message ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      {message}
    </p>
  );
}
