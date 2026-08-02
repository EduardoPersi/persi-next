import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("webhook do Inter sempre reconsulta o provedor antes de reconciliar o pedido", () => {
  const source = read("app/api/webhooks/inter/route.ts");
  assert.match(source, /getPixChargeStatus/);
  assert.match(source, /getBoletoChargeStatus/);
  assert.match(source, /reconcilePaymentReference/);
  // A chamada de reconsulta precisa vir antes da reconciliação no texto do
  // arquivo, para garantir que o status usado é sempre o resultado ao vivo.
  const getStatusIndex = source.indexOf("getPixChargeStatus(txid)");
  const reconcileIndex = source.indexOf("reconcilePaymentReference(");
  assert.ok(getStatusIndex > -1 && reconcileIndex > -1 && getStatusIndex < reconcileIndex);
});

test("webhook do PagBank sempre reconsulta o provedor antes de reconciliar o pedido", () => {
  const source = read("app/api/webhooks/pagbank/route.ts");
  assert.match(source, /getCardChargeStatus/);
  assert.match(source, /reconcilePaymentReference/);
  const getStatusIndex = source.indexOf("getCardChargeStatus(chargeId)");
  const reconcileIndex = source.indexOf("reconcilePaymentReference(");
  assert.ok(getStatusIndex > -1 && reconcileIndex > -1 && getStatusIndex < reconcileIndex);
});

test("cron de expiração de pedidos pendentes aceita POST, exige CRON_SECRET e usa comparação constante-tempo", () => {
  const source = read("app/api/cron/expire-pending-payments/route.ts");
  assert.match(source, /export async function POST/);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /isAuthorizedCronRequest/);
  const authIndex = source.indexOf("isAuthorizedCronRequest(");
  const scanIndex = source.indexOf("findPendingOrdersWithPaymentReference(");
  assert.ok(authIndex > -1 && scanIndex > -1 && authIndex < scanIndex);

  const cronLogic = read("services/payments/cronReconciliation.ts");
  assert.match(cronLogic, /timingSafeEqual/);
});

test("reconcilePaymentReference só marca pago/falho a partir de uma categoria já resolvida, nunca do corpo do webhook", () => {
  const source = read("services/payments/reconcile.ts");
  assert.doesNotMatch(source, /request\.json|await request\.text/);
});

const SERVER_ONLY_CREDENTIAL_FILES = [
  "services/payments/inter/client.ts",
  "services/payments/pagbank/client.ts",
  "services/woocommerce/restClient.ts",
];

test("módulos que tocam credenciais de pagamento importam server-only na primeira linha útil", () => {
  for (const path of SERVER_ONLY_CREDENTIAL_FILES) {
    const source = read(path);
    const firstStatement = source
      .split("\n")
      .find((line) => line.trim().length > 0);
    assert.equal(
      firstStatement.trim(),
      'import "server-only";',
      `${path} deveria importar "server-only" na primeira linha`,
    );
  }
});

function listFilesRecursively(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursively(path) : [path];
  });
}

test("nenhum componente client-side importa os clientes de pagamento com credenciais diretamente", () => {
  const checkoutFiles = listFilesRecursively("components/Checkout").filter((path) =>
    path.endsWith(".tsx"),
  );

  for (const path of checkoutFiles) {
    const source = read(path);
    if (!source.includes('"use client"')) continue;
    assert.doesNotMatch(
      source,
      /services\/payments\/(inter|pagbank)\/client/,
      `${path} não deveria importar o cliente de pagamento com credenciais`,
    );
  }
});

test("nenhum componente de pagamento envia número de cartão ou CVV cru para as próprias rotas", () => {
  let checkoutFiles = [];
  try {
    checkoutFiles = listFilesRecursively("components/Checkout").filter((path) =>
      path.endsWith(".tsx"),
    );
  } catch {
    checkoutFiles = [];
  }

  for (const path of checkoutFiles) {
    const source = read(path);
    if (!/fetch\s*\(\s*["'`]\/api\//.test(source)) continue;
    assert.doesNotMatch(
      source,
      /cardNumber|\bcvv\b|\bpan\b/i,
      `${path} não deveria enviar dado cru de cartão para uma rota própria`,
    );
  }
});
