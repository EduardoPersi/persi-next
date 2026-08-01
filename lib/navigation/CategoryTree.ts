import type { ProductCategory } from "@/types/category";

export interface NavigationCategory extends ProductCategory {
  href: string;
  children: NavigationCategory[];
}

const HIDDEN_SLUGS = new Set(["sem-categoria", "uncategorized"]);

export function buildCategoryTree(
  categories: readonly ProductCategory[],
): NavigationCategory[] {
  const visible = categories.filter(
    (category) => category.name.trim() && !HIDDEN_SLUGS.has(category.slug),
  );
  const nodes = new Map<number, NavigationCategory>();

  visible.forEach((category) => {
    nodes.set(category.id, {
      ...category,
      href: category.permalink || `/${category.slug}`,
      children: [],
    });
  });

  const roots: NavigationCategory[] = [];
  visible.forEach((category) => {
    const node = nodes.get(category.id);
    const parent = nodes.get(category.parent);
    if (!node) return;

    if (category.parent > 0 && parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

export function flattenCategoryTree(
  categories: readonly NavigationCategory[],
): NavigationCategory[] {
  return categories.flatMap((category) => [
    category,
    ...flattenCategoryTree(category.children),
  ]);
}
