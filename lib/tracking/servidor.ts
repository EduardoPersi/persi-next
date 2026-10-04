/**
 * Lê a origem da visita dos cookies, NO SERVIDOR, para gravar no pedido e
 * mandar ao painel junto com o formulário.
 *
 * Os cookies viajam sozinhos em toda requisição ao mesmo site (`/api/contact`,
 * `/api/checkout/payment`), então o navegador não precisa "entregar" nada no
 * momento do pedido — e o servidor não confia no que o cliente escreveria num
 * corpo de requisição: relê, valida e corta tudo aqui.
 *
 * A regra de consentimento vale também aqui (defesa em profundidade): cookie é
 * editável por quem visita, então, sem `persi_cookie_consent=accepted`, o
 * servidor descarta identificadores de clique, `fbp`, `fbc` e o client_id do
 * GA — mesmo que o cookie exista.
 */

import {
  COOKIE_PRIMEIRO_TOQUE,
  COOKIE_SESSAO,
  COOKIE_ULTIMO_TOQUE,
  extrairClientIdDoGa,
  lerToque,
  limpar,
  semIdentificadoresDeClique,
  validarFbc,
  validarFbp,
  type OrigemDaVisita,
  type ToqueDeOrigem,
} from "./origem.ts";

/** Mesmo nome de `lib/consent/cookieConsent.ts` (não importado: aquele arquivo usa `document`). */
const COOKIE_DE_CONSENTIMENTO = "persi_cookie_consent";

export type LeitorDeCookie = (nome: string) => string | undefined;

export function lerOrigemDosCookies(ler: LeitorDeCookie): OrigemDaVisita | undefined {
  const consentiu = ler(COOKIE_DE_CONSENTIMENTO) === "accepted";
  const preparar = (toque: ToqueDeOrigem | undefined) =>
    toque && !consentiu ? semIdentificadoresDeClique(toque) : toque;

  const origem: OrigemDaVisita = {};
  const primeiro = preparar(lerToque(ler(COOKIE_PRIMEIRO_TOQUE)));
  const ultimo = preparar(lerToque(ler(COOKIE_ULTIMO_TOQUE)));
  if (primeiro) origem.primeiro_toque = primeiro;
  if (ultimo) origem.ultimo_toque = ultimo;

  if (consentiu) {
    const clientId = extrairClientIdDoGa(ler("_ga"));
    const fbp = validarFbp(ler("_fbp"));
    const fbc = validarFbc(ler("_fbc"));
    if (clientId) origem.ga_client_id = clientId;
    if (fbp) origem.fbp = fbp;
    if (fbc) origem.fbc = fbc;
  }

  return Object.keys(origem).length > 0 ? origem : undefined;
}

export function lerIdDeSessaoDosCookies(ler: LeitorDeCookie): string | undefined {
  return limpar(ler(COOKIE_SESSAO), 40);
}

/** Texto compacto para guardar no pedido (meta `_persi_origem` do WooCommerce). */
export function serializarOrigemDoPedido(origem: OrigemDaVisita | undefined): string | undefined {
  if (!origem) return undefined;
  const texto = JSON.stringify(origem);
  // Origem com mais de 6 KB só pode ser lixo: melhor não gravar nada do que
  // gravar algo cortado no meio.
  return texto.length <= 6000 ? texto : undefined;
}

/** Faz o caminho inverso do `serializarOrigemDoPedido`, revalidando tudo. */
export function lerOrigemDoPedido(texto: string | undefined | null): OrigemDaVisita | undefined {
  if (!texto) return undefined;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return undefined;
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return undefined;
  const registro = bruto as Record<string, unknown>;
  const reempacotar = (valor: unknown) =>
    valor && typeof valor === "object"
      ? lerToque(encodeURIComponent(JSON.stringify(valor)))
      : undefined;
  const origem: OrigemDaVisita = {};
  const primeiro = reempacotar(registro.primeiro_toque);
  const ultimo = reempacotar(registro.ultimo_toque);
  if (primeiro) origem.primeiro_toque = primeiro;
  if (ultimo) origem.ultimo_toque = ultimo;
  const clientId = limpar(registro.ga_client_id, 40);
  if (clientId && /^\d{5,15}\.\d{5,12}$/.test(clientId)) origem.ga_client_id = clientId;
  const fbp = validarFbp(typeof registro.fbp === "string" ? registro.fbp : undefined);
  const fbc = validarFbc(typeof registro.fbc === "string" ? registro.fbc : undefined);
  if (fbp) origem.fbp = fbp;
  if (fbc) origem.fbc = fbc;
  return Object.keys(origem).length > 0 ? origem : undefined;
}

/**
 * Origem para gravar no pedido, a partir do armazenamento de cookies do Next
 * (`await cookies()`). Nunca lança: rastrear não pode derrubar um checkout.
 */
export function origemDoPedidoDosCookies(
  armazem: { get(nome: string): { value: string } | undefined },
): string | undefined {
  try {
    return serializarOrigemDoPedido(lerOrigemDosCookies((nome) => armazem.get(nome)?.value));
  } catch {
    return undefined;
  }
}
