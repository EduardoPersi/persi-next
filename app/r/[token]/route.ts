import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { getCartTokenCookieOptions } from "@/lib/commerce/cartResponsePolicy";
import { createRateLimiter } from "@/lib/network/rateLimit";
import {
  buscarRecuperacao,
  ehRoboDeLink,
  recuperacaoLigada,
  tokenDeRecuperacaoValido,
} from "@/lib/painel/recuperar";
import { recriarCarrinho } from "@/lib/painel/recuperarCarrinho";
import {
  COOKIE_RECUPERACAO,
  COOKIE_RECUPERACAO_SEGUNDOS,
  serializarRecuperacao,
} from "@/lib/painel/recuperarCookie";
import { SITE_URL } from "@/lib/routing/storefrontUrls";
import {
  addItemToCart,
  applyCartCoupon,
  getCart,
  updateCartItem,
} from "@/services/woocommerce/cart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Link de recuperação de carrinho que o CRM manda ao cliente:
// persimateriais.com.br/r/<token>. Contrato: docs/contrato-carrinho-crm.md.
//
//  - Robô (prévia do WhatsApp, Facebook, buscadores): uma página simples, sem
//    criar carrinho e sem falar com o CRM. O token NÃO é consumido no GET.
//  - Pessoa: o CRM devolve o carrinho, o site o recria só com itens em estoque
//    e a preço de agora, e leva ao checkout. O pré-preenchimento vai num cookie
//    httpOnly de 10 min (nada de dado pessoal na URL).
//  - Qualquer problema (token inválido, vencido, já comprado, CRM fora do ar):
//    a MESMA resposta, e nunca o motivo técnico.
//
// O token nunca é registrado em log.

const rateLimiter = createRateLimiter(60 * 1000, 20);

function cabecalhosSeguros(headers: Headers) {
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return headers;
}

function redirecionar(caminho: string) {
  const resposta = NextResponse.redirect(new URL(caminho, SITE_URL), 302);
  cabecalhosSeguros(resposta.headers);
  return resposta;
}

const AVISO_EXPIRADO = "/carrinho?aviso=link-expirado";

function paginaParaRobos() {
  const base = SITE_URL.replace(/\/+$/, "");
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Continue sua compra na Persi Materiais</title>
<meta property="og:site_name" content="Persi Materiais">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="Continue sua compra na Persi Materiais">
<meta property="og:description" content="Seus produtos estão esperando por você.">
<meta property="og:image" content="${base}/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp">
</head>
<body>
<main>
<h1>Continue sua compra na Persi Materiais</h1>
<p><a href="${base}/carrinho">Continuar minha compra na Persi</a></p>
</main>
</body>
</html>`;
  const headers = cabecalhosSeguros(new Headers({ "Content-Type": "text/html; charset=utf-8" }));
  return new NextResponse(html, { status: 200, headers });
}

async function tratar(request: Request, token: string) {
  // Desligado: vai direto ao carrinho, sem chamar o CRM.
  if (!recuperacaoLigada()) return redirecionar("/carrinho");

  // Robô: página simples. Não cria carrinho, não chama o CRM, não consome o token.
  if (ehRoboDeLink(request.headers.get("user-agent"), request.method)) {
    return paginaParaRobos();
  }

  if (rateLimiter.isLimited(request.headers)) {
    const resposta = new NextResponse("Muitas solicitações. Tente de novo em instantes.", {
      status: 429,
    });
    cabecalhosSeguros(resposta.headers);
    return resposta;
  }

  if (!tokenDeRecuperacaoValido(token)) return redirecionar(AVISO_EXPIRADO);

  const dados = await buscarRecuperacao(token);
  if (!dados || dados.itens.length === 0) return redirecionar(AVISO_EXPIRADO);

  const loja = await cookies();
  let resultado;
  try {
    resultado = await recriarCarrinho(dados, loja.get(CART_TOKEN_COOKIE)?.value, {
      getCart,
      addItem: addItemToCart,
      updateItem: updateCartItem,
      applyCoupon: applyCartCoupon,
    });
  } catch {
    return redirecionar(AVISO_EXPIRADO);
  }

  // Nada coube no carrinho (tudo sem estoque) e ele continua vazio.
  if (resultado.cart.items.length === 0) return redirecionar("/carrinho?aviso=itens-indisponiveis");

  const resposta = redirecionar("/checkout");
  const producao = process.env.NODE_ENV === "production";
  if (resultado.cartToken) {
    resposta.cookies.set(CART_TOKEN_COOKIE, resultado.cartToken, getCartTokenCookieOptions(producao));
  }
  resposta.cookies.set(
    COOKIE_RECUPERACAO,
    serializarRecuperacao({
      contato: dados.contato,
      aviso: {
        restaurados: resultado.restaurados,
        ausentes: resultado.ausentes,
        ajustados: resultado.ajustados,
      },
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: producao,
      path: "/",
      maxAge: COOKIE_RECUPERACAO_SEGUNDOS,
    },
  );
  return resposta;
}

export async function GET(request: Request, contexto: { params: Promise<{ token: string }> }) {
  return tratar(request, (await contexto.params).token);
}

export async function HEAD(request: Request, contexto: { params: Promise<{ token: string }> }) {
  return tratar(request, (await contexto.params).token);
}
