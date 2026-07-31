export interface BreadcrumbCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
  current?: boolean;
}

export interface BuildProductBreadcrumbOptions {
  productName: string;
  productCategoryIds: readonly number[];
  categories: readonly BreadcrumbCategory[];
  explicitPrimaryCategoryId?: number;
  excludedCategoryIds?: ReadonlySet<number>;
  maxDepth?: number;
}

type ResolveProductCategoryPathOptions = Omit<
  BuildProductBreadcrumbOptions,
  "productName"
>;

const DEFAULT_MAX_DEPTH = 20;

export function getCategoryHref(
  category: BreadcrumbCategory,
  categories: readonly BreadcrumbCategory[],
): string {
  return buildCategoryHref(category, categories);
}

function buildCategoryPath(
  category: BreadcrumbCategory,
  categoryById: ReadonlyMap<number, BreadcrumbCategory>,
  maxDepth: number,
): BreadcrumbCategory[] {
  const path: BreadcrumbCategory[] = [];
  const visitedIds = new Set<number>();
  let current: BreadcrumbCategory | undefined = category;

  while (current && path.length < maxDepth && !visitedIds.has(current.id)) {
    path.unshift(current);
    visitedIds.add(current.id);

    if (current.parent <= 0 || current.parent === current.id) break;
    current = categoryById.get(current.parent);
  }

  return path;
}

function selectPrimaryCategory(
  productCategoryIds: readonly number[],
  categoryById: ReadonlyMap<number, BreadcrumbCategory>,
  explicitPrimaryCategoryId: number | undefined,
  excludedCategoryIds: ReadonlySet<number>,
  maxDepth: number,
): BreadcrumbCategory | undefined {
  const candidates = [...new Set(productCategoryIds)]
    .map((id) => categoryById.get(id))
    .filter(
      (category): category is BreadcrumbCategory =>
        Boolean(category?.slug && !excludedCategoryIds.has(category.id)),
    );

  if (
    explicitPrimaryCategoryId !== undefined &&
    candidates.some((category) => category.id === explicitPrimaryCategoryId)
  ) {
    return categoryById.get(explicitPrimaryCategoryId);
  }

  let selected: BreadcrumbCategory | undefined;
  let selectedDepth = -1;

  for (const candidate of candidates) {
    const depth = buildCategoryPath(candidate, categoryById, maxDepth).length;
    if (
      depth > selectedDepth ||
      (depth === selectedDepth && selected && candidate.id < selected.id)
    ) {
      selected = candidate;
      selectedDepth = depth;
    }
  }

  return selected;
}

export function resolveProductCategoryPath({
  productCategoryIds,
  categories,
  explicitPrimaryCategoryId,
  excludedCategoryIds = new Set<number>(),
  maxDepth = DEFAULT_MAX_DEPTH,
}: ResolveProductCategoryPathOptions): BreadcrumbCategory[] {
  const safeMaxDepth = Math.max(1, Math.min(DEFAULT_MAX_DEPTH, maxDepth));
  const categoryById = new Map<number, BreadcrumbCategory>();

  for (const category of categories) {
    if (
      Number.isInteger(category.id) &&
      category.id > 0 &&
      !categoryById.has(category.id)
    ) {
      categoryById.set(category.id, category);
    }
  }

  const primaryCategory = selectPrimaryCategory(
    productCategoryIds,
    categoryById,
    explicitPrimaryCategoryId,
    excludedCategoryIds,
    safeMaxDepth,
  );
  return primaryCategory
    ? buildCategoryPath(primaryCategory, categoryById, safeMaxDepth)
    : [];
}

export function buildProductCategoryBreadcrumb({
  productName,
  ...options
}: BuildProductBreadcrumbOptions): BreadcrumbItem[] {
  const excludedCategoryIds = options.excludedCategoryIds ?? new Set<number>();
  const categoryPath = resolveProductCategoryPath(options);

  return [
    { label: "Home", href: "/" },
    ...categoryPath
      .filter(
        (category) =>
          category.slug && !excludedCategoryIds.has(category.id),
      )
      .map((category) => ({
        label: category.name,
        href: getCategoryHref(category, options.categories),
      })),
    { label: productName, current: true },
  ];
}

export function buildBreadcrumbListJsonLd(
  items: readonly BreadcrumbItem[],
  siteUrl: string,
  currentPath = "/",
) {
  const baseUrl = new URL(siteUrl);

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: new URL(item.href ?? currentPath, baseUrl).toString(),
    })),
  };
}
import { getCategoryHref as buildCategoryHref } from "../routing/storefrontUrls.ts";
