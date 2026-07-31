const baseUrl = process.env.WORDPRESS_URL;

if (!baseUrl) {
  throw new Error("WORDPRESS_URL não configurada.");
}

async function getAll(endpoint) {
  async function getPage(page) {
    const url = new URL(endpoint, baseUrl);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("hide_empty", "false");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${endpoint} respondeu com status ${response.status}.`);
    }

    return {
      items: await response.json(),
      totalPages: Math.min(
        Number(response.headers.get("X-WP-TotalPages")) || 1,
        50,
      ),
    };
  }

  const firstPage = await getPage(1);
  const remainingPages = [];
  const pageNumbers = Array.from(
    { length: firstPage.totalPages - 1 },
    (_, index) => index + 2,
  );

  for (let index = 0; index < pageNumbers.length; index += 5) {
    remainingPages.push(
      ...(await Promise.all(pageNumbers.slice(index, index + 5).map(getPage))),
    );
  }

  return [
    ...firstPage.items,
    ...remainingPages.flatMap((page) => page.items),
  ];
}

const [categories, products] = await Promise.all([
  getAll("/wp-json/wc/store/v1/products/categories"),
  getAll("/wp-json/wc/store/v1/products"),
]);
const categorySlugs = new Set(categories.map((item) => item.slug));
const productSlugs = new Set(products.map((item) => item.slug));

console.log(
  JSON.stringify(
    {
      totals: {
        categories: categories.length,
        products: products.length,
      },
      conflicts: {
        reservedCategories: [...categorySlugs].filter((slug) =>
          RESERVED_ROOT_SLUGS.has(slug),
        ),
        reservedProducts: [...productSlugs].filter((slug) =>
          RESERVED_ROOT_SLUGS.has(slug),
        ),
        categoryProducts: [...categorySlugs].filter((slug) =>
          productSlugs.has(slug),
        ),
      },
    },
    null,
    2,
  ),
);
import { RESERVED_ROOT_SLUGS } from "../lib/routing/storefrontUrls.ts";
