import "server-only";

import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";
import { shippingProviderCredentials } from "@/lib/db/schema";
import type { CredentialStore, StoredCredential } from "./auth";
import { decryptToken, encryptToken } from "./crypto";
import type { MelhorEnvioEnvironment } from "./config";

/**
 * CredentialStore real, sobre shipping_provider_credentials. O token nunca
 * chega ao banco em texto puro (ver crypto.ts); a chave de cifragem vive só
 * em SHIPPING_MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY (server-only).
 */
export function createMelhorEnvioCredentialStore(
  environment: MelhorEnvioEnvironment,
  tokenEncryptionKeyBase64: string,
): CredentialStore {
  const db = getDatabase();

  return {
    async load(): Promise<StoredCredential | null> {
      const [row] = await db
        .select()
        .from(shippingProviderCredentials)
        .where(
          and(
            eq(shippingProviderCredentials.provider, "melhor_envio"),
            eq(shippingProviderCredentials.environment, environment),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        accessToken: decryptToken(row.accessTokenCiphertext, tokenEncryptionKeyBase64),
        refreshToken: decryptToken(row.refreshTokenCiphertext, tokenEncryptionKeyBase64),
        accessTokenExpiresAt: row.accessTokenExpiresAt,
        refreshTokenExpiresAt: row.refreshTokenExpiresAt,
      };
    },

    async save(credential: StoredCredential): Promise<void> {
      const values = {
        provider: "melhor_envio" as const,
        environment,
        accessTokenCiphertext: encryptToken(credential.accessToken, tokenEncryptionKeyBase64),
        refreshTokenCiphertext: encryptToken(credential.refreshToken, tokenEncryptionKeyBase64),
        accessTokenExpiresAt: credential.accessTokenExpiresAt,
        refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
      };
      await db
        .insert(shippingProviderCredentials)
        .values(values)
        .onConflictDoUpdate({
          target: [shippingProviderCredentials.provider, shippingProviderCredentials.environment],
          set: {
            accessTokenCiphertext: values.accessTokenCiphertext,
            refreshTokenCiphertext: values.refreshTokenCiphertext,
            accessTokenExpiresAt: values.accessTokenExpiresAt,
            refreshTokenExpiresAt: values.refreshTokenExpiresAt,
            updatedAt: new Date(),
          },
        });
    },
  };
}
