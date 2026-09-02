import "server-only";

import type { ShippingProvider } from "../../core/provider";
import { normalizeMelhorEnvioQuotes } from "../../normalizers/melhorEnvio";
import type { ShippingQuoteRequest, ShippingQuoteResult } from "../../types";
import { getValidAccessToken } from "./auth";
import { calculateShipment } from "./client";
import { getMelhorEnvioConfig, type MelhorEnvioConfig } from "./config";
import { createMelhorEnvioCredentialStore } from "./credentialStore";

export function createMelhorEnvioProvider(
  config: MelhorEnvioConfig = getMelhorEnvioConfig(),
): ShippingProvider {
  const credentialStore = createMelhorEnvioCredentialStore(config.environment, config.tokenEncryptionKeyBase64);

  return {
    id: "melhor_envio",
    async getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
      const accessToken = await getValidAccessToken(config, credentialStore);
      const raw = await calculateShipment(config, accessToken, {
        from: { postal_code: config.originPostcode },
        to: { postal_code: request.destinationPostcode },
        products: request.items.map((item) => ({
          id: item.variantId,
          width: item.widthCm,
          height: item.heightCm,
          length: item.lengthCm,
          weight: item.weightKg,
          // A API espera valor unitário em reais (não minor units).
          insurance_value: item.insuranceValueMinor / 100,
          quantity: item.quantity,
        })),
      });

      const { quotes, warnings } = normalizeMelhorEnvioQuotes(raw, new Date(), config.quoteCacheTtlMs);
      return { destinationPostcode: request.destinationPostcode, quotes, warnings };
    },
  };
}
