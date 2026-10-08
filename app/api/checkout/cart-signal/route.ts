import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { createRateLimiter } from "@/lib/network/rateLimit";
import {
  criarRegistroDeEnvios,
  enviarCartUpdatedAoPainel,
  envioDoCarrinhoLigado,
  impressaoDoEvento,
  montarCartUpdated,
} from "@/lib/painel/carrinho";
import { SITE_URL } from "@/lib/routing/storefrontUrls";
import { lerOrigemDosCookies } from "@/lib/tracking/servidor";
import { getCart } from "@/services/woocommerce/cart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Sinal do checkout para o painel de atendimento (recuperação de carrinho).
// O navegador só diz QUEM é o cliente, em que etapa está e se aceitou o
// WhatsApp; itens, preços, total, CEP e cidade vêm do carrinho real, lido aqui
// pelo cookie. Contrato: docs/contrato-carrinho-crm.md.
//
// Falha do painel NUNCA chega ao checkout: a resposta é sempre 204 e o envio
// acontece depois dela (`after`), com erro só no log, sem dados pessoais.

const rateLimiter = createRateLimiter(60 * 1000, 30);
const registroDeEnvios = criarRegistroDeEnvios();

// `strict`: qualquer campo a mais (CPF, endereço, cartão…) é recusado.
const corpoSchema = z
  .object({
    nome: z.string().max(200).optional(),
    email: z.string().max(254).optional(),
    whatsapp: z.string().max(40).optional(),
    etapa: z.enum(["perfil", "entrega", "pagamento"]),
    optin_whatsapp: z.boolean(),
  })
  .strict();

function semConteudo() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: Request) {
  // Desligado: nem lê o corpo, nem fala com o painel.
  if (!envioDoCarrinhoLigado()) return semConteudo();

  if (rateLimiter.isLimited(request.headers)) {
    return NextResponse.json({ message: "Muitas solicitações." }, { status: 429 });
  }
  if (exceedsRequestLimit(request)) {
    return NextResponse.json({ message: "Corpo grande demais." }, { status: 413 });
  }

  const parsed = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
  }

  const loja = await cookies();
  const cartToken = loja.get(CART_TOKEN_COOKIE)?.value;
  if (!cartToken) return semConteudo();

  const sinal = {
    nome: parsed.data.nome,
    email: parsed.data.email,
    whatsapp: parsed.data.whatsapp,
    etapa: parsed.data.etapa,
    optinWhatsapp: parsed.data.optin_whatsapp,
  };
  const origem = lerOrigemDosCookies((nome) => loja.get(nome)?.value);

  after(async () => {
    try {
      const { cart } = await getCart(cartToken);
      const evento = montarCartUpdated({
        sinal,
        cart,
        cartToken,
        origem,
        siteUrl: SITE_URL,
        agora: new Date(),
      });
      if (!evento) return;
      if (!registroDeEnvios.deveEnviar(evento.sessao, impressaoDoEvento(evento), Date.now())) {
        return;
      }
      const resultado = await enviarCartUpdatedAoPainel(evento);
      if (!resultado.enviado) {
        console.warn("[cart-signal] não enviado ao painel:", resultado.motivo, resultado.status ?? "");
      }
    } catch {
      console.warn("[cart-signal] falha ao montar ou enviar o carrinho");
    }
  });

  return semConteudo();
}
