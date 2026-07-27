import type { ReactNode } from "react";

interface CheckoutSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function CheckoutSection({
  title,
  description,
  children,
}: CheckoutSectionProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-xl font-bold text-[#0c2d72]">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}
