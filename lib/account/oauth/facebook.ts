import { OAuthError } from "./errors.ts";
import type {
  NormalizedOAuthUser,
  OAuthProvider,
} from "./types.ts";
import {
  buildOAuthUrl,
  getOAuthString,
  getSafeHttpsUrl,
  isOAuthRecord,
} from "./utils.ts";

export const FACEBOOK_AUTHORIZATION_ENDPOINT =
  "https://www.facebook.com/v23.0/dialog/oauth";
export const FACEBOOK_TOKEN_ENDPOINT =
  "https://graph.facebook.com/v23.0/oauth/access_token";
export const FACEBOOK_USERINFO_ENDPOINT =
  "https://graph.facebook.com/v23.0/me";
export const FACEBOOK_OAUTH_CALLBACK_PATH =
  "/api/auth/facebook/callback";
export const FACEBOOK_OAUTH_ALLOWED_REDIRECT_URIS = [
  `https://persimateriais.com.br${FACEBOOK_OAUTH_CALLBACK_PATH}`,
] as const;

export interface FacebookOAuthConfig {
  clientId: string;
  clientSecret: string;
  graphApiVersion: string;
  redirectUri: (typeof FACEBOOK_OAUTH_ALLOWED_REDIRECT_URIS)[number];
}

export interface FacebookToken {
  accessToken: string;
}

export interface FacebookUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  picture: string;
}

export function getFacebookOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): FacebookOAuthConfig {
  const clientId = environment.FACEBOOK_CLIENT_ID?.trim();
  const clientSecret = environment.FACEBOOK_CLIENT_SECRET?.trim();
  const redirectUri = environment.FACEBOOK_OAUTH_REDIRECT_URI?.trim();
  const graphApiVersion =
    environment.FACEBOOK_GRAPH_API_VERSION?.trim();

  if (
    !clientId ||
    !clientSecret ||
    !graphApiVersion ||
    !/^v\d+\.\d+$/.test(graphApiVersion) ||
    !redirectUri ||
    !FACEBOOK_OAUTH_ALLOWED_REDIRECT_URIS.includes(
      redirectUri as FacebookOAuthConfig["redirectUri"],
    )
  ) {
    throw new OAuthError(
      503,
      "OAUTH_PROVIDER_ERROR",
      "Invalid Facebook OAuth configuration",
    );
  }

  return {
    clientId,
    clientSecret,
    graphApiVersion,
    redirectUri: redirectUri as FacebookOAuthConfig["redirectUri"],
  };
}

export function buildFacebookAuthorizationUrl(input: {
  codeChallenge: string;
  config: FacebookOAuthConfig;
  nonce: string;
  state: string;
}): URL {
  return buildOAuthUrl(
    `https://www.facebook.com/${input.config.graphApiVersion}/dialog/oauth`,
    {
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
    response_type: "code",
    scope: "email,public_profile",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    },
  );
}

export async function exchangeFacebookAuthorizationCode(
  input: {
    code: string;
    codeVerifier: string;
    config: FacebookOAuthConfig;
  },
  options: { fetchImplementation?: typeof fetch } = {},
): Promise<FacebookToken> {
  const response = await (options.fetchImplementation ?? fetch)(
    `https://graph.facebook.com/${input.config.graphApiVersion}/oauth/access_token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.config.redirectUri,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isOAuthRecord(body) ||
    typeof body.access_token !== "string" ||
    body.access_token.length > 16_384
  ) {
    throw new OAuthError(
      502,
      "OAUTH_TOKEN_INVALID",
      "Facebook token exchange failed",
    );
  }

  return { accessToken: body.access_token };
}

export async function getFacebookUser(
  token: FacebookToken,
  _input: { config: FacebookOAuthConfig; nonce: string },
  options: { fetchImplementation?: typeof fetch } = {},
): Promise<FacebookUser> {
  const url = buildOAuthUrl(
    `https://graph.facebook.com/${_input.config.graphApiVersion}/me`,
    {
    fields: "id,name,email,picture.width(300).height(300)",
    },
  );
  const response = await (options.fetchImplementation ?? fetch)(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token.accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isOAuthRecord(body)) {
    throw new OAuthError(
      502,
      "OAUTH_USERINFO_FAILED",
      "Facebook user info failed",
    );
  }

  const id = getOAuthString(body.id, 255);
  const email = getOAuthString(body.email, 320).trim().toLowerCase();
  if (!id) {
    throw new OAuthError(
      502,
      "OAUTH_USERINFO_FAILED",
      "Invalid Facebook user",
    );
  }
  if (!email) {
    throw new OAuthError(
      400,
      "OAUTH_EMAIL_NOT_FOUND",
      "Facebook email not available",
    );
  }

  const pictureData =
    isOAuthRecord(body.picture) && isOAuthRecord(body.picture.data)
      ? body.picture.data
      : {};

  return {
    id,
    email,
    firstName: "",
    lastName: "",
    name: getOAuthString(body.name, 200).trim(),
    picture: getSafeHttpsUrl(pictureData.url),
  };
}

export function normalizeFacebookUser(
  user: FacebookUser,
): NormalizedOAuthUser {
  return {
    provider: "facebook",
    providerId: user.id,
    email: user.email,
    name:
      user.name ||
      `${user.firstName} ${user.lastName}`.trim() ||
      user.email.split("@")[0],
    avatar: user.picture,
    verifiedEmail: true,
  };
}

export function getFacebookOAuthErrorOrigin(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const redirectUri = environment.FACEBOOK_OAUTH_REDIRECT_URI?.trim();
  return FACEBOOK_OAUTH_ALLOWED_REDIRECT_URIS.includes(
    redirectUri as FacebookOAuthConfig["redirectUri"],
  )
    ? new URL(redirectUri as string).origin
    : "https://persimateriais.com.br";
}

export const facebookOAuthProvider: OAuthProvider<
  FacebookOAuthConfig,
  FacebookToken,
  FacebookUser
> = {
  name: "facebook",
  buildAuthorizationUrl: buildFacebookAuthorizationUrl,
  exchangeCode: exchangeFacebookAuthorizationCode,
  getUser: getFacebookUser,
  normalizeUser: normalizeFacebookUser,
};
