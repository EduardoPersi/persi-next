import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

export type IconButtonVariant = "default" | "inverse";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
}

const variantClasses: Record<IconButtonVariant, string> = {
  default:
    "text-primary hover:bg-primary/10 active:bg-primary/15 focus-visible:ring-primary",
  inverse:
    "text-white hover:bg-white/10 active:bg-white/20 focus-visible:ring-white",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, type = "button", variant = "default", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={clsx(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  ),
);

IconButton.displayName = "IconButton";
