// OS ARTEFATOS DAS CORRIDAS DO PIM
//
// Os testes `pim*` não exercitam código: eles conferem o RESULTADO de corridas
// de enriquecimento que já aconteceram — quantos produtos foram aprovados,
// quantas chamadas de IA foram gastas, se o banco foi preservado. A evidência
// dessas corridas são arquivos JSON em `supabase/.temp/pim-ai/`.
//
// Esses arquivos NÃO estão no repositório, e não deveriam estar: são saída de
// execução, pesados, e alguns carregam dado de catálogo. Num clone limpo a
// pasta simplesmente não existe.
//
// O resultado disso era 22 linhas vermelhas no `npm test` que ninguém podia
// consertar, e que ensinavam a equipe a conviver com vermelho — e aí o
// vermelho de verdade passa despercebido. Pior: o erro era um ENOENT cru no
// meio da saída, sem dizer que o problema era o ambiente.
//
// Agora o teste DIZ o que falta e se declara pulado. Quem tiver os artefatos
// (quem rodou a corrida) vê os testes rodarem normalmente.

import { readFile } from "node:fs/promises";

const RAIZ = new URL("../../supabase/.temp/", import.meta.url);

/**
 * Lê um artefato de corrida, ou devolve `null` quando ele não está aqui.
 *
 * Nunca estoura: um teste que não pode rodar tem de dizer isso, e não morrer
 * com rastro de pilha.
 */
export async function artefatoPim(caminho) {
  try {
    return JSON.parse(await readFile(new URL(caminho, RAIZ), "utf8"));
  } catch (erro) {
    if (erro?.code === "ENOENT") return null;
    throw erro;
  }
}

/** O recado, uma vez por arquivo de teste. */
export function semArtefato(caminho) {
  console.log(
    `# (pulado) falta o artefato da corrida: supabase/.temp/${caminho}\n` +
      "#   Ele é saída de execução e não fica no repositório. Estes testes conferem\n" +
      "#   o resultado de uma corrida de enriquecimento que já aconteceu; sem o\n" +
      "#   arquivo, não há o que conferir.",
  );
}
