// Registra a URL de webhook do Banco Inter (Pix e, quando suportado pela
// conta, cobrança/boleto) a partir de APP_BASE_URL. Rodar uma vez ao
// configurar o ambiente e de novo sempre que o domínio do app mudar (ex.:
// troca do domínio de teste app.persimateriais.com.br para o definitivo
// persimateriais.com.br).
//
// Uso: node --env-file=.env.local scripts/register-inter-webhooks.mjs
//
// Não importa services/payments/inter/client.ts de propósito: aquele módulo
// importa "server-only", que lança erro sempre que é carregado fora do
// bundler do Next.js — inclusive em scripts administrativos como este. Por
// isso o cliente mTLS/OAuth2 é replicado aqui de forma mínima e autônoma.

import https from "node:https";
import axios from "axios";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

const baseUrl = requireEnv("INTER_API_BASE_URL").replace(/\/+$/, "");
const clientId = requireEnv("INTER_CLIENT_ID");
const clientSecret = requireEnv("INTER_CLIENT_SECRET");
const certificate = Buffer.from(requireEnv("INTER_CERTIFICATE_BASE64"), "base64");
const privateKey = Buffer.from(requireEnv("INTER_PRIVATE_KEY_BASE64"), "base64");
const pixKey = requireEnv("INTER_PIX_KEY");
const appBaseUrl = requireEnv("APP_BASE_URL").replace(/\/+$/, "");

const httpsAgent = new https.Agent({ cert: certificate, key: privateKey });
const client = axios.create({ baseURL: baseUrl, httpsAgent, timeout: 10_000 });

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "webhook.write webhook.read",
  });
  const response = await client.post("/oauth/v2/token", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return response.data.access_token;
}

async function registerPixWebhook(accessToken) {
  const webhookUrl = `${appBaseUrl}/api/webhooks/inter`;
  await client.put(
    `/pix/v2/webhook/${encodeURIComponent(pixKey)}`,
    { webhookUrl },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  console.log(`OK: webhook Pix registrado para ${webhookUrl}`);
}

async function registerBoletoWebhook(accessToken) {
  const webhookUrl = `${appBaseUrl}/api/webhooks/inter`;
  try {
    // Caminho ainda não confirmado em sandbox — a API de cobrança bancária
    // (boleto) do Inter pode exigir configuração pelo Internet Banking em
    // vez de um endpoint de webhook por conta. Ver "Decisões que exigem
    // confirmação externa" em docs/25-checkout-gateway-audit.md.
    await client.put(
      "/cobranca/v3/webhooks/boleto",
      { webhookUrl },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    console.log(`OK: webhook de boleto registrado para ${webhookUrl}`);
  } catch (error) {
    console.warn(
      "AVISO: não foi possível registrar o webhook de boleto automaticamente " +
        "— confirme o endpoint correto na documentação atual do Inter ou " +
        "configure manualmente pelo Internet Banking.",
      error.response?.status ? `(status ${error.response.status})` : error.message,
    );
  }
}

const accessToken = await getAccessToken();
await registerPixWebhook(accessToken);
await registerBoletoWebhook(accessToken);
