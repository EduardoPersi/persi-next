import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

/**
 * Cifra o token antes de gravar no banco (nunca texto puro — ver
 * supabase/migrations/20260901120000_shipping_core.sql e a auditoria do
 * plugin WordPress, que guardava o token em texto puro em wp_options).
 * Formato armazenado: base64(iv) + "." + base64(authTag) + "." + base64(ciphertext).
 */
export function encryptToken(plainText: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("SHIPPING_MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY deve decodificar para 32 bytes (AES-256).");
  }
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptToken(storedValue: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const [ivB64, authTagB64, ciphertextB64] = storedValue.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Formato inválido de token cifrado.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
