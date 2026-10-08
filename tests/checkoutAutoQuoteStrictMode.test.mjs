import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Normaliza a quebra de linha (no Windows o arquivo vem com CRLF) para os recortes abaixo.
const fonte = readFileSync("components/Checkout/CheckoutShippingPlaceholder.tsx", "utf8").replace(/\r\n/g, "\n");

// Em desenvolvimento o modo estrito do React monta, desmonta e monta de novo. A
// primeira montagem cota o CEP; a desmontagem cancela a requisição; se a marca
// "CEP já cotado" ficasse gravada, a segunda montagem nunca refaria a cotação.

test("ao desmontar, cancela a cotação por CEP e zera a marca de 'CEP já cotado'", () => {
  const limpeza = fonte.slice(
    fonte.indexOf("useEffect(\n    () => () => {"),
    fonte.indexOf("// Cotação só pelo CEP"),
  );
  assert.match(limpeza, /postcodeRequest\.current\?\.abort\(\)/);
  assert.match(limpeza, /lastQuotedPostcode\.current = ""/);
  // A marca é zerada DEPOIS de cancelar, dentro da mesma limpeza.
  assert.ok(limpeza.indexOf("abort()") < limpeza.lastIndexOf('lastQuotedPostcode.current = ""'));
});

test("cotação cancelada sem outra no lugar libera o CEP; cancelada por outra mais nova não mexe na marca dela", () => {
  const trecho = fonte.slice(fonte.indexOf("const quotePostcode"), fonte.indexOf("const updateAddress"));
  assert.match(
    trecho,
    /if \(result\.aborted\) \{[\s\S]*?if \(postcodeRequest\.current === controller\) lastQuotedPostcode\.current = "";[\s\S]*?return;/,
  );
});

test("a marca continua gravada quando a cotação começa (cada CEP é cotado uma vez por montagem)", () => {
  const trecho = fonte.slice(fonte.indexOf("const quotePostcode"), fonte.indexOf("const updateAddress"));
  assert.match(trecho, /lastQuotedPostcode\.current = digits;/);
});
