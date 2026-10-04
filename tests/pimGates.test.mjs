import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

// O PORTÃO DOS TESTES DO PIM NÃO PODE VIRAR "DESLIGAR OS TESTES"
//
// Os testes `pim*` conferem o RESULTADO de corridas de enriquecimento que já
// aconteceram, lendo artefatos em `supabase/.temp/pim-ai/`. Esses arquivos são
// saída de execução e não ficam no repositório — num clone limpo eles não
// existem, e os testes ficavam vermelhos sem que ninguém pudesse consertar.
//
// Pular com motivo resolve isso. Mas pular é perigoso: a mesma linha que diz
// "não tenho o artefato" diria "não quero rodar". Este arquivo guarda a
// diferença.

// Este arquivo FICA DE FORA da varredura: o nome dele casa com `pim*`, e os
// próprios padrões que ele procura ("skip: true", "test.skip(") estão escritos
// aqui dentro. Sem esta linha, ele se acusa.
const EU = "pimGates.test.mjs";

const ARQUIVOS = readdirSync("tests")
  .filter((f) => /^pim.*\.test\.mjs$/.test(f) && f !== EU)
  .map((f) => ({ nome: f, texto: readFileSync(`tests/${f}`, "utf8") }));

test("os testes do PIM existem e foram encontrados", () => {
  assert.ok(ARQUIVOS.length >= 10, `achei ${ARQUIVOS.length}`);
});

test("nenhum teste do PIM é pulado incondicionalmente", () => {
  // `skip: true` ou `test.skip(...)` desligaria o teste para sempre, inclusive
  // para quem TEM o artefato. O pulo só vale quando o arquivo não está lá.
  for (const { nome, texto } of ARQUIVOS) {
    assert.equal(
      /skip:\s*true/.test(texto),
      false,
      `${nome} tem um skip incondicional`,
    );
    assert.equal(
      /\btest\.skip\(/.test(texto),
      false,
      `${nome} usa test.skip(), que desliga sem condição`,
    );
  }
});

test("todo pulo do PIM depende do artefato existir", () => {
  for (const { nome, texto } of ARQUIVOS) {
    if (!texto.includes("skip:")) continue;
    const condicional =
      /existsSync\([^)]*\)\s*\?\s*false\s*:/.test(texto) ||
      /SEM_ARTEFATO/.test(texto) ||
      /skip:\s*"saída de corrida/.test(texto);
    assert.ok(condicional, `${nome} pula sem olhar se o artefato existe`);
  }
});

test("e o motivo do pulo diz o que falta, em português", () => {
  for (const { nome, texto } of ARQUIVOS) {
    if (!texto.includes("skip:")) continue;
    assert.match(
      texto,
      /artefato|corrida|não versionada/i,
      `${nome} pula sem dizer o motivo`,
    );
  }
});
