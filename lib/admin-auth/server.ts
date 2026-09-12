import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_AUTH_COOKIE, adminCookieOptions, getAdminAuthConfig } from "./config";

export async function createAdminAuthServerClient() {
  const store = await cookies();
  const { url, publishableKey } = getAdminAuthConfig();
  return createServerClient(url, publishableKey, {
    cookieOptions: { name: ADMIN_AUTH_COOKIE, ...adminCookieOptions },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, { ...options, ...adminCookieOptions }),
          );
        } catch {
          // Server Components cannot write cookies; the proxy refreshes them.
        }
      },
    },
  });
}
