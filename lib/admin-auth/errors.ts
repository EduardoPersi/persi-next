export type AdminAuthErrorCode =
  | "ADMIN_AUTH_FAILED"
  | "ADMIN_AUTH_UNAVAILABLE"
  | "ADMIN_MFA_FAILED";

export function safeAdminAuthMessage(code: string) {
  if (code === "ADMIN_MFA_FAILED") return "Não foi possível verificar o código.";
  if (code === "ADMIN_AUTH_UNAVAILABLE") return "A autenticação administrativa está indisponível.";
  return "Não foi possível autenticar com os dados informados.";
}
