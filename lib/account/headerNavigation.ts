export const PUBLIC_ACCOUNT_AUTH_ROUTES = [
  "/entrar",
  "/criar-conta",
  "/esqueci-minha-senha",
  "/redefinir-senha",
] as const;

export type HeaderAccountStatus = "loading" | "authenticated" | "anonymous";
export type HeaderAccountAction = "open-drawer" | "go-to-account" | "go-to-login" | "wait";

export function isAccountRoute(pathname: string): boolean {
  return pathname === "/minha-conta" || pathname.startsWith("/minha-conta/");
}

export function isPublicAccountAuthRoute(pathname: string): boolean {
  return PUBLIC_ACCOUNT_AUTH_ROUTES.some((route) => pathname === route);
}

export function getHeaderAccountAction(
  status: HeaderAccountStatus,
  pathname: string,
): HeaderAccountAction {
  if (status === "loading") return "wait";
  if (status === "authenticated") return "go-to-account";
  if (isAccountRoute(pathname) || isPublicAccountAuthRoute(pathname)) {
    return "go-to-login";
  }
  return "open-drawer";
}
