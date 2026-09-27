import { getOlistOAuthRedirectUri } from "./oauthClient";
import type { OlistOAuthApp, OlistOAuthEnvironment } from "./oauthTokens";

// Shared between app/api/admin/olist/oauth/{authorize,callback}/route.ts --
// not exported from oauthClient.ts/oauthTokens.ts since these are HTTP
// transport details (cookie names/options), not OAuth protocol logic.

export const OLIST_OAUTH_STATE_COOKIE = "persi_olist_oauth_state";
export const OLIST_OAUTH_APP_COOKIE = "persi_olist_oauth_app";
export const OLIST_OAUTH_COOKIE_MAX_AGE = 10 * 60;

export function isValidOlistOAuthApp(value: string | null | undefined): value is OlistOAuthApp {
  return value === "catalogo" || value === "pedidos";
}

// Same lesson already learned once in this project
// (lib/account/oauth/redirect.ts: NEVER build an absolute redirect URL
// from request.url -- behind Hostinger's reverse proxy that resolves to
// the internal bind address, e.g. https://0.0.0.0:3000, which a browser
// cannot reach). Derives the public origin from the same env-var-driven
// redirect URI already trusted for the OAuth callback itself, so there is
// one source of truth, not two.
export function getOlistAdminOrigin(environment: OlistOAuthEnvironment, env: NodeJS.ProcessEnv = process.env): string {
  return new URL(getOlistOAuthRedirectUri(environment, env)).origin;
}
