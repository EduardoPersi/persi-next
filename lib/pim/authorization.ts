import "server-only";

import { redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/lib/auth/session";
import type { AuthUser } from "@/lib/auth/types";

const ADMIN_ROLES = new Set(["administrator", "shop_manager"]);
const ADMIN_PERMISSIONS = new Set(["manage_woocommerce", "manage_options", "edit_products"]);

export function canManagePim(user: AuthUser): boolean {
  return user.roles.some((role) => ADMIN_ROLES.has(role)) || user.permissions.some((permission) => ADMIN_PERMISSIONS.has(permission));
}

export async function requirePimAdmin(): Promise<AuthUser> {
  const session = await getAuthenticatedSession();
  if (!session.authenticated) redirect(`/entrar?redirect=${encodeURIComponent("/admin/products")}`);
  if (!canManagePim(session.user)) redirect("/");
  return session.user;
}
