const SAFE_ADMIN_DESTINATIONS = new Set([
  "/admin",
  "/admin/pim",
  "/admin/products",
]);

export function safeAdminDestination(value: unknown): string {
  return typeof value === "string" && SAFE_ADMIN_DESTINATIONS.has(value)
    ? value
    : "/admin/products";
}
