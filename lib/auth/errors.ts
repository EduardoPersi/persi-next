export type AuthErrorCode =
  | "AUTH_CONFIGURATION_INVALID"
  | "AUTH_CREDENTIALS_REJECTED"
  | "AUTH_IDENTITY_CONFLICT"
  | "AUTH_RESPONSE_INVALID"
  | "AUTH_SERVICE_UNAVAILABLE"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_UNAUTHORIZED";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}
