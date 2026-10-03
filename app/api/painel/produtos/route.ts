import { NextResponse } from "next/server";

import { chaveConfere } from "@/lib/painel/chave";
import { paraOPainel } from "@/lib/painel/produtos";
import { createRateLimiter } from "@/lib/network/rateLimit";
import { searchWooCommerceProducts } from "@/services/woocommerce/search";

/**
 * O catálogo com PREÇO AO VIVO, para o painel de atendimento.
 *
 * Por que uma rota nova em vez de abrir a `/api/search/suggestions`: aquela é
 * pública, serve a caixa de busca do site e devolve o que convém a uma lista
 * de sugestões. Esta é autenticada, devolve preço cheio, preço promocional,
 * disponibilidade e SKU, e muda quando o atendimento precisar — sem que mexer
 * nela possa quebrar a busca de quem está comprando.
 *
 * O que ela NÃO faz: guardar preço em lugar nenhum. O painel pergunta na hora
 * de usar. Preço gravado é preço de ontem dito com a confiança de hoje.
 */

const TAMANHO_MINIMO = 2;
const TAMANHO_MAXIMO = 100;
const LIMITE_PADRAO = 8;
const LIMITE_MAXIMO = 20;

// Mais folgado que o da busca pública (30/min): aqui quem bate é UM servidor
// conhecido, não o navegador de cada visitante. O limite existe para o caso de
// um defeito no painel virar martelo, não para conter gente.
const limitador = createRateLimiter(60 * 1000, 120);

export async function GET(request: Request) {
  if (!chaveConfere(request.headers.get("x-painel-key"))) {
    // A mesma resposta para chave errada e para site sem chave configurada:
    // dizer "o site não tem chave" conta a quem perguntou como entrar.
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  if (limitador.isLimited(request.headers)) {
    return NextResponse.json(
      { message: "Muitas consultas em sequência." },
      { status: 429 },
    );
  }

  const parametros = new URL(request.url).searchParams;
  const busca = parametros.get("q")?.trim() ?? "";
  if (busca.length < TAMANHO_MINIMO || busca.length > TAMANHO_MAXIMO) {
    return NextResponse.json(
      { message: `Informe de ${TAMANHO_MINIMO} a ${TAMANHO_MAXIMO} caracteres.` },
      { status: 400 },
    );
  }

  const pedido = Number(parametros.get("limite") ?? LIMITE_PADRAO);
  const limite = Number.isInteger(pedido)
    ? Math.min(Math.max(pedido, 1), LIMITE_MAXIMO)
    : LIMITE_PADRAO;

  const siteUrl =
    process.env.SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://persimateriais.com.br";

  try {
    const produtos = await searchWooCommerceProducts(busca, { limit: limite });
    return NextResponse.json({
      produtos: produtos.slice(0, limite).map((p) => paraOPainel(p, siteUrl)),
      // Quando o preço foi lido. O painel mostra isto ao atendente: um preço
      // sem hora não deixa ninguém perceber que a consulta ficou velha na tela.
      em: new Date().toISOString(),
    });
  } catch {
    // 502 e não 500: o que falhou foi o catálogo lá atrás, e o painel precisa
    // distinguir "o site está fora" de "o site recusou" para saber se adianta
    // tentar de novo.
    return NextResponse.json(
      { message: "Não consegui consultar o catálogo agora." },
      { status: 502 },
    );
  }
}

// Sem cache: preço e estoque mudam o dia inteiro, e esta rota existe
// justamente para não repetir valor velho.
export const dynamic = "force-dynamic";
export const revalidate = 0;
