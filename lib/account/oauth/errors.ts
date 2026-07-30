import { AccountServiceError } from "../../../services/account/client.ts";

export const OAUTH_ERROR_CODES = [
  "OAUTH_STATE_INVALID",
  "OAUTH_TOKEN_INVALID",
  "OAUTH_PROVIDER_ERROR",
  "OAUTH_EMAIL_NOT_FOUND",
  "OAUTH_USERINFO_FAILED",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export class OAuthError extends AccountServiceError {
  readonly oauthCode: OAuthErrorCode;

  constructor(status: number, code: OAuthErrorCode, message: string) {
    super(status, message, code);
    this.name = "OAuthError";
    this.oauthCode = code;
  }
}
