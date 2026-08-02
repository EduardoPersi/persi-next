// Gera uma chave pública do PagBank (usada para tokenização de cartão no
// client, variável NEXT_PUBLIC_PAGBANK_PUBLIC_KEY).
//
// IMPORTANTE: só rodar isso para PRODUÇÃO de verdade. Em sandbox a chave
// pública do PagBank é fixa e já vem documentada em .env.example — não
// precisa gerar nada nem rodar este script para testar em sandbox.
//
// Uso: node --env-file=.env.local scripts/generate-pagbank-public-key.mjs
//
// Referência oficial: https://developer.pagbank.com.br/reference/criar-chave-publica
//
// Não importa services/payments/pagbank/client.ts de propósito: aquele
// módulo importa "server-only", que lança erro sempre que é carregado fora
// do bundler do Next.js — inclusive em scripts administrativos como este.
// Por isso a chamada é replicada aqui de forma mínima e autônoma (mesmo
// padrão de scripts/register-inter-webhooks.mjs).

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

const baseUrl = requireEnv("PAGBANK_API_BASE_URL").replace(/\/+$/, "");
const clientSecret = requireEnv("PAGBANK_CLIENT_SECRET");

async function generatePublicKey() {
  let response;
  try {
    response = await fetch(`${baseUrl}/public-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ type: "card" }),
    });
  } catch {
    throw new Error(
      "Não foi possível conectar ao PagBank. Confira PAGBANK_API_BASE_URL e a conexão de rede.",
    );
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || typeof body?.public_key !== "string") {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "O PagBank recusou o token informado — confira se PAGBANK_CLIENT_SECRET é " +
          "válido e se a conta já está habilitada para gerar chave pública de produção.",
      );
    }
    throw new Error(
      `O PagBank respondeu com status ${response.status} e não retornou uma chave pública válida.`,
    );
  }

  return body;
}

try {
  const { public_key: publicKey, created_at: createdAt } = await generatePublicKey();
  const generatedAt = Number.isFinite(createdAt)
    ? new Date(createdAt).toISOString()
    : new Date().toISOString();

  console.log(
    "Chave gerada. Copie o valor abaixo para NEXT_PUBLIC_PAGBANK_PUBLIC_KEY",
  );
  console.log("no painel de Variáveis de Ambiente da Hostinger (produção):\n");
  console.log(publicKey);
  console.log(`\nGerada em: ${generatedAt}`);
  console.log(
    "\nAVISO: as chaves públicas do PagBank não expiram, mas o PagBank " +
      "recomenda renovação a cada intervalo inferior a 2 anos — guarde a " +
      "data acima em que você gerou esta chave.",
  );
} catch (error) {
  console.error(`Falha ao gerar a chave pública do PagBank: ${error.message}`);
  process.exitCode = 1;
}
