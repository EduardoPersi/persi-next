/**
 * Origem da visita (UTM, identificadores de clique, referrer), em funções
 * PURAS — sem `document`, `window` nem rede. É o que decide:
 *
 *  - o que conta como "campanha";
 *  - quando o último toque é trocado;
 *  - o que pode ser gravado em cookie PERSISTENTE (só com consentimento).
 *
 * Fica separado do código do navegador de propósito: a regra de negócio e a
 * regra de privacidade são as partes que não podem regredir sem ninguém ver,
 * e função pura é a que se testa sem montar um navegador.
 *
 * O formato dos campos é o do contrato do painel
 * (`docs/contrato-api-sites.md` do persi-atendimento, seção 2).
 */

export const CAMPOS_UTM = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

/** Identificadores de clique de anúncio: só persistem com consentimento. */
export const CAMPOS_ID_DE_CLIQUE = ["gclid", "gbraid", "wbraid", "fbclid"] as const;

export type CampoUtm = (typeof CAMPOS_UTM)[number];
export type CampoIdDeClique = (typeof CAMPOS_ID_DE_CLIQUE)[number];

/** Um "toque": a visita que trouxe a pessoa, com o que sabemos dela. */
export type ToqueDeOrigem = Partial<Record<CampoUtm | CampoIdDeClique, string>> & {
  pagina_entrada?: string;
  referrer?: string;
  /** ISO-8601 de quando o toque aconteceu. */
  em: string;
};

export interface OrigemDaVisita {
  primeiro_toque?: ToqueDeOrigem;
  ultimo_toque?: ToqueDeOrigem;
  ga_client_id?: string;
  fbp?: string;
  fbc?: string;
}

export type Consentimento = "accepted" | "declined" | null;

/** 90 dias — janela de atribuição decidida no plano (seção 2). */
export const JANELA_DO_COOKIE_SEGUNDOS = 60 * 60 * 24 * 90;

export const COOKIE_PRIMEIRO_TOQUE = "persi_ft";
export const COOKIE_ULTIMO_TOQUE = "persi_lt";
export const COOKIE_SESSAO = "persi_sid";

/** Tetos do contrato: 300 por padrão, 512 para identificadores de clique. */
const LIMITE_PADRAO = 300;
const LIMITE_ID_DE_CLIQUE = 512;
const LIMITE_PAGINA = 1000;

/**
 * Limpa um valor vindo de URL ou cookie — ambos controlados por quem visita.
 * Tira caracteres de controle e corta no teto; vazio vira `undefined` para o
 * campo simplesmente não existir no objeto.
 */
export function limpar(valor: unknown, maximo = LIMITE_PADRAO): string | undefined {
  if (typeof valor !== "string") return undefined;
  // A faixa \u0000–\u001f e o \u007f são exatamente o que queremos remover.
  const limpo = valor.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maximo);
  return limpo === "" ? undefined : limpo;
}

function limiteDoCampo(campo: string): number {
  if ((CAMPOS_ID_DE_CLIQUE as readonly string[]).includes(campo)) return LIMITE_ID_DE_CLIQUE;
  if (campo === "pagina_entrada" || campo === "referrer") return LIMITE_PAGINA;
  return LIMITE_PADRAO;
}

/** Lê UTMs e identificadores de clique de uma query string (`?a=b&c=d`). */
export function lerParametrosDeCampanha(
  search: string,
): Partial<Record<CampoUtm | CampoIdDeClique, string>> {
  const params = new URLSearchParams(search);
  const resultado: Partial<Record<CampoUtm | CampoIdDeClique, string>> = {};
  for (const campo of [...CAMPOS_UTM, ...CAMPOS_ID_DE_CLIQUE]) {
    const valor = limpar(params.get(campo), limiteDoCampo(campo));
    if (valor) resultado[campo] = valor;
  }
  return resultado;
}

export function temParametroDeCampanha(
  parametros: Partial<Record<CampoUtm | CampoIdDeClique, string>>,
): boolean {
  return Object.keys(parametros).length > 0;
}

/**
 * O referrer é "externo" quando aponta para fora do próprio site. Sem
 * referrer (acesso direto, app, link de e-mail sem rastreio) não é externo.
 *
 * `dominiosProprios` aceita o domínio-raiz: `persimateriais.com.br` cobre
 * `www.`, `loja.` e `zap.` — voltar do WhatsApp/checkout para o site não pode
 * ser contado como uma nova origem.
 */
export function referrerEhExterno(
  referrer: string | undefined | null,
  dominiosProprios: readonly string[],
): boolean {
  if (!referrer) return false;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return false;
  }
  return !dominiosProprios.some((dominio) => {
    const d = dominio.toLowerCase().replace(/^www\./, "");
    return host === d || host === `www.${d}` || host.endsWith(`.${d}`);
  });
}

export type TipoDeVisita = "campanha" | "referrer" | "direto";

export interface VisitaCapturada {
  tipo: TipoDeVisita;
  toque: ToqueDeOrigem;
}

/**
 * Descreve a visita atual.
 *
 *  - `campanha`: tem UTM ou identificador de clique → troca o último toque;
 *  - `referrer`: sessão nova vinda de site externo → troca o último toque;
 *  - `direto`: o resto → NÃO troca nada (só semeia, se ainda não há toque).
 *
 * O referrer só vale em sessão nova: dentro da mesma sessão, `document.referrer`
 * de uma recarga do próprio site já é interno, mas em um voltar-do-gateway
 * poderia ser "externo" e apagar a campanha que trouxe a pessoa.
 */
export function descreverVisita(entrada: {
  search: string;
  /** Origem + caminho da página, SEM query (a query pode ter id de clique). */
  paginaDeEntrada: string;
  referrer: string | undefined | null;
  dominiosProprios: readonly string[];
  novaSessao: boolean;
  agora: Date;
}): VisitaCapturada {
  const campanha = lerParametrosDeCampanha(entrada.search);
  const externo = referrerEhExterno(entrada.referrer, entrada.dominiosProprios);
  const base: ToqueDeOrigem = {
    pagina_entrada: limpar(entrada.paginaDeEntrada, LIMITE_PAGINA),
    em: entrada.agora.toISOString(),
  };
  if (externo) base.referrer = limpar(entrada.referrer, LIMITE_PAGINA);

  if (temParametroDeCampanha(campanha)) {
    return { tipo: "campanha", toque: { ...campanha, ...base } };
  }
  if (externo && entrada.novaSessao) return { tipo: "referrer", toque: base };
  // Direto: sem referrer externo registrado para não "inventar" origem.
  return { tipo: "direto", toque: { pagina_entrada: base.pagina_entrada, em: base.em } };
}

/** Remove o que é identificador de anúncio (não pode persistir sem consentimento). */
export function semIdentificadoresDeClique(toque: ToqueDeOrigem): ToqueDeOrigem {
  const copia: ToqueDeOrigem = { ...toque };
  for (const campo of CAMPOS_ID_DE_CLIQUE) delete copia[campo];
  return copia;
}

export interface ToquesGuardados {
  primeiro?: ToqueDeOrigem;
  ultimo?: ToqueDeOrigem;
}

/**
 * Decide os dois toques depois de uma visita.
 *
 *  - Primeiro toque: só nasce uma vez (a primeira visita, mesmo direta).
 *    Exceção: se ele foi gravado nesta mesma visita (mesmo `em`) sem os
 *    identificadores de clique — porque ainda não havia consentimento — e
 *    agora existe, é completado.
 *  - Último toque: só muda em visita de campanha ou de referrer externo.
 *    Visita direta nunca apaga a campanha que trouxe a pessoa (é o que mantém
 *    a atribuição por 90 dias).
 */
export function decidirToques(
  guardados: ToquesGuardados,
  visita: VisitaCapturada,
): ToquesGuardados {
  const { tipo, toque } = visita;

  let primeiro = guardados.primeiro;
  if (!primeiro || primeiro.em === toque.em) primeiro = toque;

  let ultimo = guardados.ultimo;
  if (tipo !== "direto") ultimo = toque;
  else if (!ultimo) ultimo = toque;

  return { primeiro, ultimo };
}

export interface CookieParaGravar {
  nome: string;
  valor: string;
  /** Ausente = cookie de sessão (some ao fechar o navegador). */
  maxAgeSegundos?: number;
}

/**
 * A REGRA DE CONSENTIMENTO, num lugar só.
 *
 *  - Com consentimento (`accepted`): primeiro e último toque COMPLETOS, 90 dias.
 *  - Sem consentimento (`declined` ou ainda sem resposta): só as UTMs, página
 *    e referrer da visita, em cookie de SESSÃO. Nada de gclid/gbraid/wbraid/
 *    fbclid e nada persistente.
 *
 * O id da sessão (`persi_sid`) é cookie de sessão nos dois casos: não
 * identifica ninguém além da visita e serve para o painel agrupar cliques.
 */
export function planejarCookies(
  consentimento: Consentimento,
  toques: ToquesGuardados,
  sid: string,
): CookieParaGravar[] {
  const consentiu = consentimento === "accepted";
  const preparar = (toque: ToqueDeOrigem) =>
    consentiu ? toque : semIdentificadoresDeClique(toque);
  const cookies: CookieParaGravar[] = [{ nome: COOKIE_SESSAO, valor: sid }];
  const duracao = consentiu ? { maxAgeSegundos: JANELA_DO_COOKIE_SEGUNDOS } : {};
  if (toques.primeiro) {
    cookies.push({
      nome: COOKIE_PRIMEIRO_TOQUE,
      valor: serializarToque(preparar(toques.primeiro)),
      ...duracao,
    });
  }
  if (toques.ultimo) {
    cookies.push({
      nome: COOKIE_ULTIMO_TOQUE,
      valor: serializarToque(preparar(toques.ultimo)),
      ...duracao,
    });
  }
  return cookies;
}

/** Texto do cookie (valor já seguro para `document.cookie`). */
export function serializarToque(toque: ToqueDeOrigem): string {
  const enxuto: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(toque)) {
    const limpo = limpar(valor, limiteDoCampo(campo));
    if (limpo) enxuto[campo] = limpo;
  }
  return encodeURIComponent(JSON.stringify(enxuto));
}

const CAMPOS_DO_TOQUE: readonly string[] = [
  ...CAMPOS_UTM,
  ...CAMPOS_ID_DE_CLIQUE,
  "pagina_entrada",
  "referrer",
  "em",
];

/**
 * Lê um cookie de toque. Cookie é entrada de quem visita: só entram campos
 * conhecidos, como texto, com teto — qualquer outra coisa é descartada. Sem
 * `em` válido, o toque é inválido.
 */
export function lerToque(valor: string | undefined | null): ToqueDeOrigem | undefined {
  if (!valor) return undefined;
  let bruto: unknown;
  try {
    bruto = JSON.parse(decodeURIComponent(valor));
  } catch {
    return undefined;
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return undefined;
  const registro = bruto as Record<string, unknown>;
  const em = limpar(registro.em, 40);
  if (!em || Number.isNaN(Date.parse(em))) return undefined;
  const toque: ToqueDeOrigem = { em };
  for (const campo of CAMPOS_DO_TOQUE) {
    if (campo === "em") continue;
    const limpo = limpar(registro[campo], limiteDoCampo(campo));
    if (limpo) (toque as Record<string, string>)[campo] = limpo;
  }
  return toque;
}

/** `GA1.1.1234567890.1700000000` → `1234567890.1700000000` (o client_id do GA4). */
export function extrairClientIdDoGa(cookieGa: string | undefined | null): string | undefined {
  if (!cookieGa) return undefined;
  const partes = cookieGa.split(".");
  if (partes.length < 4 || !partes[0].startsWith("GA")) return undefined;
  const clientId = `${partes[2]}.${partes[3]}`;
  return /^\d{5,15}\.\d{5,12}$/.test(clientId) ? clientId : undefined;
}

/** `_fbp`: `fb.1.<timestamp>.<aleatório>`. Formato inesperado é descartado. */
export function validarFbp(valor: string | undefined | null): string | undefined {
  const limpo = limpar(valor, 100);
  return limpo && /^fb\.\d\.\d{10,13}\.\d{3,20}$/.test(limpo) ? limpo : undefined;
}

/** `_fbc`: `fb.1.<timestamp>.<fbclid>`. */
export function validarFbc(valor: string | undefined | null): string | undefined {
  const limpo = limpar(valor, 512);
  return limpo && /^fb\.\d\.\d{10,13}\.[\w-]{3,500}$/.test(limpo) ? limpo : undefined;
}

/** Id de sessão aleatório, sem dado pessoal. */
export function gerarIdDeSessao(aleatorio: () => string): string {
  return aleatorio().replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
}
