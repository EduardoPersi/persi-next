/**
 * Configuração pública do rastreio.
 *
 * As variáveis `NEXT_PUBLIC_*` são trocadas pelo valor no momento da build —
 * por isso são lidas com o nome escrito por extenso, uma a uma, e não por
 * `process.env[nome]`. Mudou o valor na Hostinger? Precisa de nova build.
 */

export const LINKS_BASE_URL_PADRAO = "https://zap.persimateriais.com.br";

/** Código de link: letras, números, hífen e sublinhado (formato do painel). */
const CODIGO_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

export interface ConfigDeLinks {
  /** Endereço do subdomínio de links, sem barra no fim. */
  base: string;
  /** Código do link padrão criado no painel. Vazio = rastreio desligado. */
  codigo: string;
}

/** Normaliza os dois valores (puro, para testar sem depender do ambiente). */
export function normalizarConfigDeLinks(
  baseBruta: string | undefined,
  codigoBruto: string | undefined,
): ConfigDeLinks {
  let base = LINKS_BASE_URL_PADRAO;
  const candidata = baseBruta?.trim();
  if (candidata) {
    try {
      const url = new URL(candidata);
      // http só para testar contra o painel de mentira em localhost.
      if (url.protocol === "https:" || url.protocol === "http:") {
        base = url.origin + url.pathname.replace(/\/+$/, "");
      }
    } catch {
      // Valor torto: cai no padrão em vez de quebrar o botão.
    }
  }
  const codigo = codigoBruto?.trim() ?? "";
  return { base, codigo: CODIGO_VALIDO.test(codigo) ? codigo : "" };
}

export const CONFIG_DE_LINKS: ConfigDeLinks = normalizarConfigDeLinks(
  process.env.NEXT_PUBLIC_LINKS_BASE_URL,
  process.env.NEXT_PUBLIC_WHATSAPP_LINK_CODIGO,
);

/**
 * Domínios do próprio site: um referrer vindo deles não é "origem nova".
 * `NEXT_PUBLIC_TRACKING_DOMINIOS_PROPRIOS` (separados por vírgula) permite
 * acrescentar outros; o padrão cobre o site, a loja e o subdomínio de links.
 */
export function lerDominiosProprios(extra: string | undefined): string[] {
  const padrao = ["persimateriais.com.br"];
  const adicionais = (extra ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  return [...new Set([...padrao, ...adicionais])];
}

export const DOMINIOS_PROPRIOS = lerDominiosProprios(
  process.env.NEXT_PUBLIC_TRACKING_DOMINIOS_PROPRIOS,
);
