"use client";

import { useCallback, useRef } from "react";
import { normalizePostcode } from "@/lib/commerce/shippingCalculator";
import type { CartAddress } from "@/types/cart";

// Consulta isolada de endereço por CEP (app/api/shipping/postcode), que só
// reaproveita o mesmo serviço já usado pelo cálculo de frete
// (services/shipping/postcode.ts -> ViaCEP) sem disparar um cálculo de
// frete completo.
//
// Resultado:
// - `CartAddress`: endereço encontrado;
// - `null`: CEP inválido, não encontrado ou falha de rede — quem chamar
//   decide como tratar (nunca trava a tela com erro);
// - `undefined`: a consulta foi substituída por outra mais nova (o cliente
//   mudou o CEP) e o resultado deve ser ignorado, sem tratar como falha.
export type PostcodeLookupResult = CartAddress | null | undefined;

interface InflightLookup {
  digits: string;
  controller: AbortController;
  promise: Promise<PostcodeLookupResult>;
}

export function usePostcodeAddressLookup() {
  const inflight = useRef<InflightLookup | null>(null);
  const resolved = useRef<{ digits: string; address: CartAddress } | null>(
    null,
  );

  return useCallback((postcode: string): Promise<PostcodeLookupResult> => {
    const digits = normalizePostcode(postcode);
    if (digits.length !== 8) return Promise.resolve(null);

    // Mesmo CEP já resolvido: digitar de novo não pode virar "não encontrado".
    if (resolved.current?.digits === digits) {
      return Promise.resolve(resolved.current.address);
    }
    // Mesmo CEP já em consulta: reaproveita a chamada em andamento.
    if (inflight.current?.digits === digits) return inflight.current.promise;

    inflight.current?.controller.abort();
    const controller = new AbortController();

    const promise = (async (): Promise<PostcodeLookupResult> => {
      try {
        const response = await fetch("/api/shipping/postcode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postcode: digits }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return controller.signal.aborted ? undefined : null;
        const body = (await response.json().catch(() => null)) as
          | { address?: CartAddress | null }
          | null;
        if (controller.signal.aborted) return undefined;
        const address = body?.address ?? null;
        if (address) resolved.current = { digits, address };
        return address;
      } catch {
        return controller.signal.aborted ? undefined : null;
      } finally {
        if (inflight.current?.controller === controller) {
          inflight.current = null;
        }
      }
    })();

    inflight.current = { digits, controller, promise };
    return promise;
  }, []);
}
