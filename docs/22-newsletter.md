# Newsletter (rodapé)

## Objetivo

O formulário "Assine nossa newsletter" no rodapé permite que visitantes se
inscrevam por e-mail. O Next.js apenas valida e encaminha a inscrição: o
WordPress (plugin `persi-headless`, módulo `newsletter`) é responsável por
persistir o inscrito, exigir confirmação por e-mail (double opt-in) e
processar o cancelamento. Nenhuma campanha é enviada por este módulo — ele
apenas mantém a lista de inscritos confirmados para uma ferramenta de e-mail
marketing consumir depois.

## Configuração necessária no WordPress

Módulo `newsletter` do plugin `persi-headless` (`includes/newsletter/`),
habilitado por padrão em WooCommerce > Persi Headless:

- endpoint REST autenticado por HMAC para receber inscrições do Next.js;
- tabela própria (`wp_persi_newsletter_subscribers`) com e-mail
  criptografado (AES-256-GCM) e hash para busca/deduplicação;
- double opt-in obrigatório: e-mail de confirmação com link de uso único;
- unsubscribe com token próprio de uso único;
- rate limiting por e-mail e por IP, honeypot e resposta neutra (não revela
  se um e-mail já está cadastrado);
- registro do consentimento (versão e URL da política, origem autenticada,
  hashes de IP/User-Agent — nunca valores brutos);
- anonimização automática: inscrições `pending` sem confirmação expiram em
  7 dias; inscrições `unsubscribed` são anonimizadas em 30 dias; inscrições
  `confirmed` permanecem ativas indefinidamente até o próprio inscrito
  cancelar.

## Configuração do Next.js

Defina apenas no servidor:

```dotenv
WORDPRESS_NEWSLETTER_ENDPOINT=https://persimateriais.com.br/wp-json/persi/v1/newsletter/subscribe
PERSI_HEADLESS_NEWSLETTER_HMAC_SECRET=
PERSI_HEADLESS_NEWSLETTER_HMAC_KEY_ID=primary
PERSI_HEADLESS_NEWSLETTER_ORIGIN=https://app.persimateriais.com.br
```

O navegador envia os dados para `POST /api/newsletter`. A rota valida o
corpo, aplica uma limitação básica em memória e encaminha ao WordPress sem
expor URL privada, credenciais ou tokens. O servidor Next.js adiciona a
versão e a URL da política e assina o corpo bruto com HMAC SHA-256, mesma
mecânica de `lib/stock-notifications/hmac.ts`, em `lib/newsletter/hmac.ts` —
segredo e origem são exclusivos deste módulo, não reaproveitam os do aviso
de estoque.

Confirmação e cancelamento usam páginas headless
(`/confirmar-newsletter`, `/cancelar-newsletter`), tokens de uso único,
respostas `no-store` e `Referrer-Policy: no-referrer`.

## Contrato enviado

```json
{
  "email": "cliente@exemplo.com",
  "website": "",
  "consent": true
}
```

`website` é um campo honeypot (deve chegar vazio) e `consent` é sempre
`true`: o formulário do rodapé não usa checkbox — o consentimento é
indicado por um texto passivo abaixo do campo, com link para a Política de
Privacidade, visível antes do clique em ENVIAR.

## Diferenças em relação ao aviso de estoque

- Inscrição é global por e-mail, sem associação a produto/variação.
- Sem fila de envio via Action Scheduler — este módulo não dispara nenhum
  e-mail além da confirmação da própria inscrição.
- Uma nova inscrição após cancelamento reaproveita a mesma linha da tabela
  (via `email_hash`) em vez de criar um novo ciclo.
