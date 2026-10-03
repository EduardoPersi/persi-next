/**
 * Mensagens automáticas do site pelo WhatsApp da loja.
 *
 * Quem envia é o painel de atendimento (persi-atendimento), que já tem o
 * número conectado. O site só pede: `POST /api/webhooks/site/notificar` com a
 * chave compartilhada no cabeçalho.
 *
 * REGRA DE OURO: falhar aqui NUNCA derruba o fluxo principal. Se o painel
 * estiver fora do ar, o pedido continua feito e a recuperação de senha
 * continua valendo pelos outros caminhos. Por isso nada aqui lança — todas as
 * funções devolvem um resultado que diz o que houve, e quem chama segue a
 * vida.
 *
 * O painel não guarda nem valida código de acesso: ele só entrega. Gerar,
 * guardar e conferir é do lado de cá.
 */

const TEMPO_LIMITE_MS = 8000;

export type TipoDeAviso = "pedido" | "codigo_acesso";

export type AvisoDePedido = {
  tipo: "pedido";
  telefone: string;
  pedido: string;
  status: string;
  cliente?: string;
  total_centavos?: number;
  observacao?: string;
  /** Só entra na mensagem se for do próprio site; o painel descarta o resto. */
  link?: string;
};

export type AvisoDeCodigo = {
  tipo: "codigo_acesso";
  telefone: string;
  /** De 4 a 12 letras ou números. Gerado e guardado aqui, não no painel. */
  codigo: string;
  validade_minutos?: number;
};

export type Aviso = AvisoDePedido | AvisoDeCodigo;

export type ResultadoDoAviso =
  | { enviado: true; conversa: number | null }
  | { enviado: false; motivo: string; status?: number; podeTentarDeNovo: boolean };

function configuracao() {
  const url = process.env.PAINEL_URL?.trim();
  const chave = process.env.SITE_WEBHOOK_KEY?.trim();
  if (!url || !chave) return null;
  return { url: url.replace(/\/+$/, ""), chave };
}

/**
 * Manda o aviso. Devolve o que aconteceu; nunca lança.
 *
 * `podeTentarDeNovo` separa o que adianta repetir (painel fora do ar, tempo
 * esgotado) do que não adianta (chave errada, telefone inválido, limite por
 * telefone atingido) — para quem tiver fila de reenvio não ficar batendo numa
 * porta que não vai abrir.
 */
export async function avisarPeloWhatsapp(aviso: Aviso): Promise<ResultadoDoAviso> {
  const config = configuracao();
  if (!config) {
    // Sem configuração não é erro do cliente: é o site que ainda não foi
    // ligado ao painel. Fica no log e a vida segue.
    return {
      enviado: false,
      motivo: "PAINEL_URL ou SITE_WEBHOOK_KEY não estão no .env",
      podeTentarDeNovo: false,
    };
  }

  const corta = new AbortController();
  const relogio = setTimeout(() => corta.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(`${config.url}/api/webhooks/site/notificar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Site-Webhook-Key": config.chave,
      },
      body: JSON.stringify(aviso),
      signal: corta.signal,
      cache: "no-store",
    });

    if (resposta.ok) {
      const corpo = (await resposta.json().catch(() => ({}))) as { conversa?: number };
      return { enviado: true, conversa: corpo.conversa ?? null };
    }

    const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };
    return {
      enviado: false,
      motivo: corpo.error || `o painel respondeu ${resposta.status}`,
      status: resposta.status,
      // 5xx é problema do painel e passa; 4xx é pedido torto e não passa.
      podeTentarDeNovo: resposta.status >= 500,
    };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === "AbortError";
    return {
      enviado: false,
      motivo: abortou ? "o painel demorou demais para responder" : "não consegui falar com o painel",
      podeTentarDeNovo: true,
    };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Avisa do pedido sem deixar nada estourar para quem chamou.
 *
 * É a forma de usar no fluxo de checkout: `void avisarPedido(...)` segue em
 * frente, e a falha vai para o log em vez de virar um erro na cara do cliente
 * que acabou de pagar.
 */
export async function avisarPedido(dados: Omit<AvisoDePedido, "tipo">): Promise<ResultadoDoAviso> {
  const resultado = await avisarPeloWhatsapp({ tipo: "pedido", ...dados });
  if (!resultado.enviado) {
    console.error(`[whatsapp] pedido ${dados.pedido} não avisado: ${resultado.motivo}`);
  }
  return resultado;
}

export async function avisarCodigoDeAcesso(
  dados: Omit<AvisoDeCodigo, "tipo">
): Promise<ResultadoDoAviso> {
  const resultado = await avisarPeloWhatsapp({ tipo: "codigo_acesso", ...dados });
  if (!resultado.enviado) {
    // O telefone NÃO entra no log: é dado do cliente e log é lido por muita
    // gente. O motivo basta para depurar; o painel tem o diário com os quatro
    // últimos dígitos.
    console.error(`[whatsapp] código de acesso não entregue: ${resultado.motivo}`);
  }
  return resultado;
}

/**
 * Um código de acesso de 6 caracteres, sorteado com gerador criptográfico.
 *
 * `Math.random()` não serve para isto: é previsível, e quem prevê o código
 * entra na conta de outra pessoa. Sem I, O, 0 e 1 — no WhatsApp, lidos às
 * pressas, viram um ao outro.
 */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function gerarCodigoDeAcesso(tamanho = 6): string {
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  let codigo = "";
  for (const b of bytes) codigo += ALFABETO[b % ALFABETO.length];
  return codigo;
}
