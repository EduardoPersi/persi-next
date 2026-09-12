export type AdminMfaAssurance = "verified" | "not_verified" | "unknown";

export function mapSupabaseAal(
  currentLevel: string | null | undefined,
  hasError = false,
): AdminMfaAssurance {
  if (hasError) return "unknown";
  if (currentLevel === "aal2") return "verified";
  if (currentLevel === "aal1") return "not_verified";
  return "unknown";
}
