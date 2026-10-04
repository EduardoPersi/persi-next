/**
 * Formulário do site → painel de atendimento (`POST /api/webhooks/site/lead`).
 *
 * Contrato: `docs/contrato-api-sites.md` do persi-atendimento, seção 2.
 *
 * Roda SÓ NO SERVIDOR: a chave (`PAINEL_LEAD_CHAVE`) não tem prefixo
 * `NEXT_PUBLIC_` e nunca vai ao navegador. O navegador só fala com `/api/…` do
 * próprio site.
 *
 * MELHOR ESFORÇO, como em `whatsapp.ts`: o painel fora do ar, lento ou
 * recusando NUNCA derruba o envio do formulário. Aqui nada lança; o resultado
 * diz o que houve e a falha vai para o log do servidor SEM dados pessoais
 * (nada de nome, e-mail, telefone ou mensagem — só o motivo e o status).
 * Sem repetir em laço: o contrato diz que reenviar é seguro, mas o formulário
 * não deve esperar por isso.
 */

import type { OrigemDaVisita } from "../tracking/origem.ts";

/** Curto de propósito: o visitante não pode esperar o painel. */
const TEMPO_LIMITE_MS = 3500;

export interface ContatoDoLead {
  nome?: string;
  telefone?: string;
  email?: string;
  mensagem?: string;
  cidade?: string;
}

export interface CorpoDoLead {
  tipo: "formulario";
  contato: ContatoDoLead;
  /** Só existe quando a pessoa marcou a caixa. Omitido = não consentiu. */
  consentimento_marketing?: true;
  origem?: OrigemDaVisita;
  pagina?: string;
  formulario?: string;
}

/** Tetos do contrato: nome 200, mensagem 2000; os demais com folga. */
const TETOS: Record<keyof ContatoDoLead, number> = {
  nome: 200,
  telefone: 40,
  email: 254,
  mensagem: 2000,
  cidade: 120,
};

function cortar(valor: string | undefined, maximo: number): string | undefined {
  const texto = valor?.trim();
  return texto ? texto.slice(0, maximo) : undefined;
}

/**
 * Monta o corpo do contrato. Campo vazio não vai (o painel valida o que vem).
 * `consentimento_marketing` só sai quando é `true`: o contrato diz que omitido
 * significa "não consentiu", e mandar `false` seria dizer mais do que
 * sabemos.
 */
export function montarCorpoDoLead(entrada: {
  contato: ContatoDoLead;
  consentimentoMarketing?: boolean;
  origem?: OrigemDaVisita;
  pagina?: string;
  formulario?: string;
}): CorpoDoLead {
  const contato: ContatoDoLead = {};
  for (const campo of Object.keys(TETOS) as Array<keyof ContatoDoLead>) {
    const valor = cortar(entrada.contato[campo], TETOS[campo]);
    if (valor) contato[campo] = valor;
  }
  const corpo: CorpoDoLead = { tipo: "formulario", contato };
  if (entrada.consentimentoMarketing === true) corpo.consentimento_marketing = true;
  if (entrada.origem) corpo.origem = entrada.origem;
  const pagina = cortar(entrada.pagina, 1000);
  if (pagina) corpo.pagina = pagina;
  const formulario = cortar(entrada.formulario, 200);
  if (formulario) corpo.formulario = formulario;
  return corpo;
}

export interface ConfigDoLead {
  url: string;
  empresa: string;
  chave: string;
}

/** Sem as três variáveis, o painel simplesmente não é chamado. */
export function configDoLead(env: Record<string, string | undefined> = process.env): ConfigDoLead | null {
  const url = env.PAINEL_URL?.trim();
  const empresa = env.PAINEL_EMPRESA_SLUG?.trim();
  const chave = env.PAINEL_LEAD_CHAVE?.trim();
  if (!url || !empresa || !chave) return null;
  return { url: url.replace(/\/+$/, ""), empresa, chave };
}

export type ResultadoDoLead =
  | { enviado: true; status: number; teste: boolean }
  | { enviado: false; motivo: string; status?: number };

interface OpcoesDoEnvio {
  /** Modo teste: cabeçalho `X-Persi-Teste: 1` — o painel autentica e valida, sem gravar. */
  teste?: boolean;
  config?: ConfigDoLead | null;
  fetchImpl?: typeof fetch;
  tempoLimiteMs?: number;
}

/**
 * Manda o lead ao painel. Devolve o que aconteceu; nunca lança.
 * Quem chama deve ignorar o resultado — ele existe para teste e log.
 */
export async function enviarLeadAoPainel(
  corpo: CorpoDoLead,
  opcoes: OpcoesDoEnvio = {},
): Promise<ResultadoDoLead> {
  const config = opcoes.config === undefined ? configDoLead() : opcoes.config;
  if (!config) {
    // Não é erro: é o site que ainda não foi ligado ao painel. Sem log, para
    // não encher o servidor de aviso a cada formulário enviado.
    return {
      enviado: false,
      motivo: "PAINEL_URL, PAINEL_EMPRESA_SLUG ou PAINEL_LEAD_CHAVE não configurados",
    };
  }

  const buscar = opcoes.fetchImpl ?? fetch;
  const corta = new AbortController();
  const relogio = setTimeout(() => corta.abort(), opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS);
  try {
    const resposta = await buscar(`${config.url}/api/webhooks/site/lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Persi-Empresa": config.empresa,
        "X-Persi-Chave": config.chave,
        ...(opcoes.teste ? { "X-Persi-Teste": "1" } : {}),
      },
      body: JSON.stringify(corpo),
      signal: corta.signal,
      cache: "no-store",
    });
    if (resposta.ok) return { enviado: true, status: resposta.status, teste: Boolean(opcoes.teste) };

    const motivo = `o painel respondeu ${resposta.status}`;
    console.error(`[painel-lead] lead não enviado: ${motivo}`);
    return { enviado: false, motivo, status: resposta.status };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === "AbortError";
    const motivo = abortou
      ? "o painel demorou demais para responder"
      : "não consegui falar com o painel";
    console.error(`[painel-lead] lead não enviado: ${motivo}`);
    return { enviado: false, motivo };
  } finally {
    clearTimeout(relogio);
  }
}
