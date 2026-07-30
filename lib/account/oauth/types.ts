export type OAuthProviderName =
  | "google"
  | "facebook"
  | "instagram"
  | "apple"
  | "microsoft";

export interface NormalizedOAuthUser {
  provider: OAuthProviderName;
  providerId: string;
  email: string;
  name: string;
  avatar: string;
  verifiedEmail: boolean;
}

export interface OAuthAuthorizationInput<TConfig> {
  codeChallenge: string;
  config: TConfig;
  nonce: string;
  state: string;
}

export interface OAuthCodeExchangeInput<TConfig> {
  code: string;
  codeVerifier: string;
  config: TConfig;
}

export interface OAuthUserInput<TConfig> {
  config: TConfig;
  nonce: string;
}

export interface OAuthProvider<TConfig, TToken, TUser> {
  readonly name: OAuthProviderName;
  buildAuthorizationUrl(
    input: OAuthAuthorizationInput<TConfig>,
  ): URL;
  exchangeCode(
    input: OAuthCodeExchangeInput<TConfig>,
    options?: { fetchImplementation?: typeof fetch },
  ): Promise<TToken>;
  getUser(
    token: TToken,
    input: OAuthUserInput<TConfig>,
    options?: {
      fetchImplementation?: typeof fetch;
      now?: number;
    },
  ): Promise<TUser>;
  normalizeUser(user: TUser): NormalizedOAuthUser;
}

export interface OAuthTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}
