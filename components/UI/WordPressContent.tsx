import clsx from "clsx";

export type WordPressContentVariant = "institutional" | "storefront";

export interface WordPressContentProps {
  html?: string;
  variant?: WordPressContentVariant;
  className?: string;
  /**
   * Quando o elemento pai já aplica a classe `institutional-content` (ex.:
   * `InstitutionalPageLayout`), evita duplicar a classe no wrapper interno.
   */
  bare?: boolean;
}

export function WordPressContent({
  html,
  variant = "institutional",
  className,
  bare = false,
}: WordPressContentProps) {
  if (!html) return null;

  return (
    <div
      className={clsx(
        !bare && "institutional-content",
        !bare && variant === "storefront" && "institutional-content--storefront",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
