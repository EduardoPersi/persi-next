import type { ReactNode } from "react";

interface PaymentResultLayoutProps {
  orderId: number;
  instructions: ReactNode;
  helperText?: ReactNode;
  children: ReactNode;
}

// Casco visual compartilhado pelas telas de "aguardando pagamento"
// (Pix, boleto e qualquer gateway assíncrono futuro): ação à esquerda,
// número do pedido e instrução à direita. Cada gateway só entra com o
// conteúdo da ação (QR Code, linha digitável, etc.) em `children`.
export function PaymentResultLayout({
  orderId,
  instructions,
  helperText,
  children,
}: PaymentResultLayoutProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {children}
      </div>

      <div>
        <h1 className="text-xl font-bold text-[#0c2d72] sm:text-2xl">
          Pedido {orderId}
        </h1>
        <p className="mt-3 text-base leading-6 text-slate-700">{instructions}</p>
        {helperText ? (
          <p className="mt-3 text-xs text-slate-500">{helperText}</p>
        ) : null}
      </div>
    </div>
  );
}
