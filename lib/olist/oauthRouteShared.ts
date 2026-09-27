import type { OlistOAuthApp } from "./oauthTokens";

// Shared between app/api/admin/olist/oauth/{authorize,callback}/route.ts --
// not exported from oauthClient.ts/oauthTokens.ts since these are HTTP
// transport details (cookie names/options), not OAuth protocol logic.

export const OLIST_OAUTH_STATE_COOKIE = "persi_olist_oauth_state";
export const OLIST_OAUTH_APP_COOKIE = "persi_olist_oauth_app";
export const OLIST_OAUTH_COOKIE_MAX_AGE = 10 * 60;

export function isValidOlistOAuthApp(value: string | null | undefined): value is OlistOAuthApp {
  return value === "catalogo" || value === "pedidos";
}
