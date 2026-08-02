import { isValidBrazilianCnpj } from "./cnpj.ts";
import { isValidBrazilianCpf } from "./cpf.ts";

export type BrazilianDocumentType = "cpf" | "cnpj";

export function detectBrazilianDocumentType(
  value: string,
): BrazilianDocumentType | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
}

export function isValidBrazilianDocument(value: string): boolean {
  const type = detectBrazilianDocumentType(value);
  if (type === "cpf") return isValidBrazilianCpf(value);
  if (type === "cnpj") return isValidBrazilianCnpj(value);
  return false;
}
