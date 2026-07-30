import type { OAuthProviderName } from "./types.ts";
import { facebookOAuthProvider } from "./facebook.ts";
import { googleOAuthProvider } from "./google.ts";

const providers = {
  google: googleOAuthProvider,
  facebook: facebookOAuthProvider,
} as const;

export function getOAuthProvider(
  provider: "google",
): typeof googleOAuthProvider;
export function getOAuthProvider(
  provider: "facebook",
): typeof facebookOAuthProvider;
export function getOAuthProvider(
  provider: Extract<OAuthProviderName, "google" | "facebook">,
) {
  return providers[provider];
}

export type {
  OAuthProvider,
  NormalizedOAuthUser,
} from "./types.ts";
