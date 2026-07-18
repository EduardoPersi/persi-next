import type {
  ComponentPropsWithoutRef,
  ElementType,
  ReactNode,
} from "react";

type ContainerSize = "sm" | "md" | "lg" | "xl" | "full";

type ContainerProps<T extends ElementType = "div"> = {
  as?: T;
  children: ReactNode;
  size?: ContainerSize;
  padded?: boolean;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

const sizeClasses: Record<ContainerSize, string> = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-7xl",
  xl: "max-w-[1440px]",
  full: "max-w-none",
};

export function Container<T extends ElementType = "div">({
  as,
  children,
  size = "lg",
  padded = true,
  className = "",
  ...props
}: ContainerProps<T>) {
  const Component = as ?? "div";

  const classes = [
    "mx-auto w-full",
    sizeClasses[size],
    padded ? "px-4 sm:px-6 lg:px-8" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component className={classes} {...props}>
      {children}
    </Component>
  );
}