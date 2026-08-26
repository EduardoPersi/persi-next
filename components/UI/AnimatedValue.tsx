import type { ReactNode } from "react";

interface AnimatedValueProps {
  animationKey: string | number;
  children: ReactNode;
  className?: string;
}

export function AnimatedValue({
  animationKey,
  children,
  className,
}: AnimatedValueProps) {
  return (
    <span key={animationKey} className={`checkout-value-update ${className ?? ""}`}>
      {children}
    </span>
  );
}
