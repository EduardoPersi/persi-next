export interface JwtTokenResponse {
  token: string;
  expiresAt: string;
  userEmail?: string;
  userNicename?: string;
  userDisplayName?: string;
}

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  displayName: string;
  firstName: string;
  lastName: string;
  roles: string[];
  avatar: string;
  permissions: string[];
}

export interface AuthenticatedSession {
  authenticated: true;
  expiresAt: string | null;
  user: AuthUser;
}

export interface AnonymousSession {
  authenticated: false;
}

export type AuthSession = AuthenticatedSession | AnonymousSession;

export interface AuthRequestOptions {
  method?: "GET" | "POST";
  token?: string;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}
