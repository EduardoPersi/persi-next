const PRIVATE_PATHS = ["/minha-conta", "/checkout"] as const;
const AUTH_PATHS = ["/entrar"] as const;

export function isPrivateAuthPath(pathname: string): boolean {
  return PRIVATE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isPublicAuthPath(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname as (typeof AUTH_PATHS)[number]);
}

export function getAuthRedirect(input: {
  pathname: string;
  authenticated: boolean;
}): string | null {
  if (!input.authenticated && isPrivateAuthPath(input.pathname)) return "/entrar";
  if (input.authenticated && isPublicAuthPath(input.pathname)) return "/minha-conta";
  return null;
}
