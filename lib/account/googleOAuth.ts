import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  type JsonWebKey as NodeJsonWebKey,
  verify,
} from "node:crypto";
import { AccountServiceError } from "../../services/account/client.ts";

export const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_ENDPOINT =
  "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/google/callback";
export const GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS = [
  `https://yellowgreen-ram-345959.hostingersite.com${GOOGLE_OAUTH_CALLBACK_PATH}`,
  `https://persimateriais.com.br${GOOGLE_OAUTH_CALLBACK_PATH}`,
] as const;
export const GOOGLE_OAUTH_COOKIE_MAX_AGE = 10 * 60;
export const GOOGLE_OAUTH_STATE_COOKIE = "persi_google_oauth_state";
export const GOOGLE_OAUTH_NONCE_COOKIE = "persi_google_oauth_nonce";
export const GOOGLE_OAUTH_VERIFIER_COOKIE = "persi_google_oauth_verifier";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: (typeof GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS)[number];
}

export interface GoogleIdentity {
  provider: "google";
  subject: string;
  email: string;
  emailVerified: true;
  firstName: string;
  lastName: string;
  displayName: string;
  picture: string;
}

type GoogleJwk = NodeJsonWebKey & {
  alg?: string;
  kid?: string;
  kty?: string;
  use?: string;
};

interface GoogleIdTokenClaims {
  aud?: unknown;
  azp?: unknown;
  email?: unknown;
  email_verified?: unknown;
  exp?: unknown;
  family_name?: unknown;
  given_name?: unknown;
  iat?: unknown;
  iss?: unknown;
  name?: unknown;
  nonce?: unknown;
  picture?: unknown;
  sub?: unknown;
}

let jwksCache:
  | {
      expiresAt: number;
      keys: GoogleJwk[];
    }
  | undefined;

function requireServerValue(
  environment: NodeJS.ProcessEnv,
  name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_OAUTH_REDIRECT_URI",
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new AccountServiceError(503, "Missing Google OAuth configuration");
  }
  return value;
}

export function getGoogleOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfig {
  const redirectUri = requireServerValue(
    environment,
    "GOOGLE_OAUTH_REDIRECT_URI",
  );
  if (
    !GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS.includes(
      redirectUri as GoogleOAuthConfig["redirectUri"],
    )
  ) {
    throw new AccountServiceError(503, "Invalid Google OAuth redirect URI");
  }

  return {
    clientId: requireServerValue(environment, "GOOGLE_CLIENT_ID"),
    clientSecret: requireServerValue(environment, "GOOGLE_CLIENT_SECRET"),
    redirectUri: redirectUri as GoogleOAuthConfig["redirectUri"],
  };
}

export function getGoogleOAuthErrorOrigin(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim() ?? "";
  return GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS.includes(
    redirectUri as GoogleOAuthConfig["redirectUri"],
  )
    ? new URL(redirectUri).origin
    : new URL(GOOGLE_OAUTH_ALLOWED_REDIRECT_URIS[0]).origin;
}

export function generateGoogleOAuthValue(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createGooglePkce(): {
  codeChallenge: string;
  codeVerifier: string;
} {
  const codeVerifier = generateGoogleOAuthValue(48);
  return {
    codeVerifier,
    codeChallenge: createHash("sha256")
      .update(codeVerifier, "ascii")
      .digest("base64url"),
  };
}

export function buildGoogleAuthorizationUrl(input: {
  codeChallenge: string;
  config: GoogleOAuthConfig;
  nonce: string;
  state: string;
}): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url;
}

export function getGoogleOAuthCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: GOOGLE_OAUTH_CALLBACK_PATH.replace("/callback", ""),
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE,
  };
}

export function safeGoogleOAuthEqual(
  received: string,
  expected: string,
): boolean {
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function validateGoogleOAuthCallbackInput(input: {
  code: string;
  codeVerifier: string;
  expectedState: string;
  nonce: string;
  state: string;
}): void {
  if (
    !input.code ||
    input.code.length > 4_096 ||
    !input.state ||
    !input.expectedState ||
    !safeGoogleOAuthEqual(input.state, input.expectedState) ||
    !/^[A-Za-z0-9_-]{20,128}$/.test(input.nonce) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeVerifier)
  ) {
    throw new AccountServiceError(400, "Invalid Google OAuth callback");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function exchangeGoogleAuthorizationCode(
  input: {
    code: string;
    codeVerifier: string;
    config: GoogleOAuthConfig;
  },
  options: { fetchImplementation?: typeof fetch } = {},
): Promise<string> {
  const response = await (options.fetchImplementation ?? fetch)(
    GOOGLE_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        redirect_uri: input.config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: input.codeVerifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isRecord(body) ||
    typeof body.id_token !== "string" ||
    body.id_token.length > 16_384
  ) {
    throw new AccountServiceError(502, "Google token exchange failed");
  }
  return body.id_token;
}

function decodeJwtPart(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AccountServiceError(401, "Invalid Google ID token");
  }
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new AccountServiceError(401, "Invalid Google ID token");
  }
}

function cacheMaxAge(value: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(value ?? "");
  return match ? Math.min(Number(match[1]), 86_400) : 300;
}

async function getGoogleJwks(
  fetchImplementation: typeof fetch,
  now: number,
): Promise<GoogleJwk[]> {
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;

  const response = await fetchImplementation(GOOGLE_JWKS_ENDPOINT, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isRecord(body) ||
    !Array.isArray(body.keys) ||
    body.keys.length < 1
  ) {
    throw new AccountServiceError(502, "Google keys unavailable");
  }
  const keys = body.keys.filter(
    (key): key is GoogleJwk =>
      isRecord(key) &&
      key.kty === "RSA" &&
      key.use === "sig" &&
      key.alg === "RS256" &&
      typeof key.kid === "string",
  );
  if (keys.length < 1) {
    throw new AccountServiceError(502, "Google keys unavailable");
  }
  jwksCache = {
    keys,
    expiresAt: now + cacheMaxAge(response.headers.get("cache-control")) * 1000,
  };
  return keys;
}

function stringClaim(value: unknown, maxLength: number): string {
  return typeof value === "string" && value.length <= maxLength ? value : "";
}

function validateAudience(
  audience: unknown,
  authorizedParty: unknown,
  clientId: string,
): boolean {
  if (audience === clientId) return true;
  return (
    Array.isArray(audience) &&
    audience.includes(clientId) &&
    audience.length > 0 &&
    audience.every((item) => typeof item === "string") &&
    authorizedParty === clientId
  );
}

export async function validateGoogleIdToken(
  idToken: string,
  input: {
    clientId: string;
    nonce: string;
  },
  options: {
    fetchImplementation?: typeof fetch;
    now?: number;
  } = {},
): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new AccountServiceError(401, "Invalid Google ID token");
  }
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]) as GoogleIdTokenClaims;
  if (
    !isRecord(header) ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !isRecord(claims)
  ) {
    throw new AccountServiceError(401, "Invalid Google ID token");
  }

  const now = options.now ?? Date.now();
  const keys = await getGoogleJwks(options.fetchImplementation ?? fetch, now);
  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new AccountServiceError(401, "Invalid Google ID token");

  const signature = Buffer.from(parts[2], "base64url");
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "ascii");
  let signatureValid = false;
  try {
    signatureValid = verify(
      "RSA-SHA256",
      signed,
      createPublicKey({ key, format: "jwk" }),
      signature,
    );
  } catch {
    throw new AccountServiceError(401, "Invalid Google ID token");
  }

  const nowSeconds = Math.floor(now / 1000);
  if (
    !signatureValid ||
    !["https://accounts.google.com", "accounts.google.com"].includes(
      String(claims.iss),
    ) ||
    !validateAudience(claims.aud, claims.azp, input.clientId) ||
    typeof claims.exp !== "number" ||
    claims.exp <= nowSeconds ||
    (typeof claims.iat === "number" && claims.iat > nowSeconds + 300) ||
    claims.nonce !== input.nonce ||
    claims.email_verified !== true
  ) {
    throw new AccountServiceError(401, "Invalid Google ID token");
  }

  const subject = stringClaim(claims.sub, 255);
  const email = stringClaim(claims.email, 320).trim().toLowerCase();
  const firstName = stringClaim(claims.given_name, 100).trim();
  const lastName = stringClaim(claims.family_name, 100).trim();
  const displayName =
    stringClaim(claims.name, 200).trim() ||
    `${firstName} ${lastName}`.trim() ||
    email.split("@")[0];
  const pictureValue = stringClaim(claims.picture, 2_048);
  let picture = "";
  if (pictureValue) {
    try {
      const pictureUrl = new URL(pictureValue);
      if (pictureUrl.protocol === "https:") picture = pictureUrl.toString();
    } catch {
      picture = "";
    }
  }
  if (
    !/^[A-Za-z0-9_-]{1,255}$/.test(subject) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AccountServiceError(401, "Invalid Google ID token");
  }

  return {
    provider: "google",
    subject,
    email,
    emailVerified: true,
    firstName,
    lastName,
    displayName,
    picture,
  };
}

export function resetGoogleJwksCacheForTests(): void {
  jwksCache = undefined;
}
