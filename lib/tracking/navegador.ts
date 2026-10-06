/**
 * A parte do rastreio que usa o navegador: lê a URL e os cookies, aplica as
 * regras puras de `origem.ts` e grava os cookies.
 *
 * Nada aqui roda no servidor. Todas as funções começam checando `document` e
 * engolem erro de cookie bloqueado: rastrear é secundário, e o site precisa
 * funcionar igual com cookies desligados.
 */

import { readCookieConsent } from "../consent/cookieConsent.ts";
import { DOMINIOS_PROPRIOS, CONFIG_DE_LINKS } from "./config.ts";
import {
  COOKIE_PRIMEIRO_TOQUE,
  COOKIE_SESSAO,
  COOKIE_ULTIMO_TOQUE,
  decidirToques,
  descreverVisita,
  extrairClientIdDoGa,
  gerarIdDeSessao,
  lerParametrosDeCampanha,
  lerToque,
  planejarCookies,
  temParametroDeCampanha,
  validarFbc,
  validarFbp,
  type Consentimento,
  type CookieParaGravar,
  type OrigemDaVisita,
  type VisitaCapturada,
} from "./origem.ts";
import { montarHrefRastreado, type ContextoDoClique } from "./whatsappLink.ts";

/** Disparado depois de gravar os cookies: quem mostra link rastreado reavalia. */
export const EVENTO_RASTREIO = "persi:rastreio";

function lerCookies(): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const parte of document.cookie.split("; ")) {
    const posicao = parte.indexOf("=");
    if (posicao > 0) resultado[parte.slice(0, posicao)] = parte.slice(posicao + 1);
  }
  return resultado;
}

function gravarCookie({ nome, valor, maxAgeSegundos }: CookieParaGravar): void {
  const seguro = window.location.protocol === "https:" ? "; Secure" : "";
  const duracao = maxAgeSegundos ? `; Max-Age=${maxAgeSegundos}` : "";
  // First-party, sem `Domain`: vale só para este host. SameSite=Lax porque o
  // cookie é lido nas requisições do próprio site, não em contexto de terceiro.
  document.cookie = `${nome}=${valor}; Path=/${duracao}; SameSite=Lax${seguro}`;
}

function novoIdDeSessao(): string {
  const aleatorio =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? () => crypto.randomUUID()
      : () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return gerarIdDeSessao(aleatorio);
}

/**
 * A visita desta carga de página, guardada em memória.
 *
 * Existe por dois motivos: (1) navegar entre rotas do App Router não recarrega
 * a página, então o `referrer` e o "sessão nova" só valem na primeira chamada;
 * (2) se a pessoa aceitar os cookies no meio da visita, o gclid que veio na URL
 * (e que NÃO foi gravado antes) ainda está aqui para ser gravado agora.
 */
let visitaEmMemoria: VisitaCapturada | null = null;
let queryDaVisita = "";

/**
 * Registra a visita e grava os cookies conforme o consentimento. Pode ser
 * chamada várias vezes (troca de rota, mudança de consentimento): é
 * idempotente para a mesma visita.
 */
export function registrarVisita(consentimento: Consentimento): void {
  if (typeof document === "undefined") return;
  try {
    const cookies = lerCookies();
    const sidExistente = cookies[COOKIE_SESSAO];
    const search = window.location.search;

    const chegouCampanhaNova =
      temParametroDeCampanha(lerParametrosDeCampanha(search)) && search !== queryDaVisita;
    if (!visitaEmMemoria || chegouCampanhaNova) {
      visitaEmMemoria = descreverVisita({
        search,
        paginaDeEntrada: `${window.location.origin}${window.location.pathname}`,
        referrer: document.referrer,
        dominiosProprios: DOMINIOS_PROPRIOS,
        novaSessao: !sidExistente,
        agora: new Date(),
      });
      queryDaVisita = search;
    }

    const toques = decidirToques(
      {
        primeiro: lerToque(cookies[COOKIE_PRIMEIRO_TOQUE]),
        ultimo: lerToque(cookies[COOKIE_ULTIMO_TOQUE]),
      },
      visitaEmMemoria,
    );
    const sid = sidExistente || novoIdDeSessao();
    for (const cookie of planejarCookies(consentimento, toques, sid)) gravarCookie(cookie);
    window.dispatchEvent(new Event(EVENTO_RASTREIO));
  } catch {
    // Cookies bloqueados ou URL estranha: o site segue sem rastreio.
  }
}

/** O que se sabe da visita agora, já respeitando o consentimento. */
export function lerContextoDoClique(): ContextoDoClique {
  const consentiu = readCookieConsent() === "accepted";
  const cookies = lerCookies();
  const origem: OrigemDaVisita = {};
  const primeiro = lerToque(cookies[COOKIE_PRIMEIRO_TOQUE]);
  const ultimo = lerToque(cookies[COOKIE_ULTIMO_TOQUE]);
  if (primeiro) origem.primeiro_toque = primeiro;
  if (ultimo) origem.ultimo_toque = ultimo;
  if (consentiu) {
    const clientId = extrairClientIdDoGa(cookies._ga);
    const fbp = validarFbp(cookies._fbp);
    const fbc = validarFbc(cookies._fbc);
    if (clientId) origem.ga_client_id = clientId;
    if (fbp) origem.fbp = fbp;
    if (fbc) origem.fbc = fbc;
  }
  return {
    origem,
    pagina: `${window.location.origin}${window.location.pathname}`,
    sid: cookies[COOKIE_SESSAO],
    consentiu,
  };
}

/** Link rastreado completo para o momento atual (ou o `fallbackHref`). */
export function lerHrefRastreado(fallbackHref: string): string {
  try {
    return montarHrefRastreado(CONFIG_DE_LINKS, fallbackHref, lerContextoDoClique());
  } catch {
    return fallbackHref;
  }
}
