/**
 * Montagem do link rastreado de WhatsApp:
 *
 *   <base>/w/<codigo>?utm_…&gclid…&ga=…&pg=…&ref=…&fbp=…&fbc=…&sid=…
 *
 * Contrato: `docs/contrato-api-sites.md` do painel, seção 1. Todos os
 * parâmetros são opcionais; manda-se o que houver. O painel responde 302 para
 * o `wa.me`.
 *
 * REGRA DE OURO: sem código configurado, devolve o link original (`wa.me`).
 * O botão de WhatsApp é dinheiro — rastreio mal configurado não pode tirá-lo
 * do ar.
 */

import {
  CAMPOS_ID_DE_CLIQUE,
  CAMPOS_UTM,
  limpar,
  semIdentificadoresDeClique,
  type OrigemDaVisita,
} from "./origem.ts";
import type { ConfigDeLinks } from "./config.ts";

export interface ContextoDoClique {
  origem?: OrigemDaVisita;
  /** Página onde o clique acontece (origem + caminho). */
  pagina?: string;
  /** Id da sessão (cookie `persi_sid`). */
  sid?: string;
  /** Sem consentimento de marketing: nada de identificador de anúncio. */
  consentiu: boolean;
}

/** Tetos do contrato: 300 padrão, 512 ids de clique, 1000 para pg/ref. */
const TETO_ID = 512;
const TETO_PAGINA = 1000;

export function linkRastreadoBase(config: ConfigDeLinks): string | null {
  if (!config.codigo) return null;
  return `${config.base}/w/${encodeURIComponent(config.codigo)}`;
}

/**
 * Link que sai no HTML do servidor: já é o rastreado, só que sem parâmetros.
 * Funciona sem JavaScript (o painel redireciona do mesmo jeito). O cliente
 * completa os parâmetros depois.
 */
export function hrefInicial(config: ConfigDeLinks, fallbackHref: string): string {
  return linkRastreadoBase(config) ?? fallbackHref;
}

export function montarHrefRastreado(
  config: ConfigDeLinks,
  fallbackHref: string,
  contexto: ContextoDoClique,
): string {
  const base = linkRastreadoBase(config);
  if (!base) return fallbackHref;

  const params = new URLSearchParams();
  const adicionar = (nome: string, valor: string | undefined, teto = 300) => {
    const limpo = limpar(valor, teto);
    if (limpo) params.set(nome, limpo);
  };

  // Último toque: é o que atribui o clique (padrão do plano, seção 2).
  const toque = contexto.origem?.ultimo_toque;
  const permitido = toque && (contexto.consentiu ? toque : semIdentificadoresDeClique(toque));
  if (permitido) {
    for (const campo of CAMPOS_UTM) adicionar(campo, permitido[campo]);
    for (const campo of CAMPOS_ID_DE_CLIQUE) adicionar(campo, permitido[campo], TETO_ID);
  }
  if (contexto.consentiu) {
    adicionar("ga", contexto.origem?.ga_client_id);
    adicionar("fbp", contexto.origem?.fbp);
    adicionar("fbc", contexto.origem?.fbc, TETO_ID);
  }
  adicionar("pg", contexto.pagina, TETO_PAGINA);
  adicionar("ref", permitido?.referrer, TETO_PAGINA);
  adicionar("sid", contexto.sid);

  const texto = params.toString();
  return texto ? `${base}?${texto}` : base;
}
