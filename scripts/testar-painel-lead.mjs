// Confere, depois do deploy, se o site consegue falar com o painel de
// atendimento (formulário → lead). NÃO cria lead: usa o modo teste do painel
// (cabeçalho `X-Persi-Teste: 1`), que autentica e valida sem gravar.
//
// Uso (na Hostinger, com as variáveis do site, ou localmente):
//   node --env-file=.env.local scripts/testar-painel-lead.mjs
//   npm run painel:testar-lead
//
// Variáveis lidas (as mesmas do servidor do site):
//   PAINEL_URL, PAINEL_EMPRESA_SLUG, PAINEL_LEAD_CHAVE
//
// Sai com código 0 se tudo certo e 1 se algo precisa de atenção. A chave nunca
// é impressa.

const TEMPO_LIMITE_MS = 8000;

const url = process.env.PAINEL_URL?.trim().replace(/\/+$/, "");
const empresa = process.env.PAINEL_EMPRESA_SLUG?.trim();
const chave = process.env.PAINEL_LEAD_CHAVE?.trim();

function falhar(mensagem) {
  console.error(`\nX  ${mensagem}`);
  process.exit(1);
}

const faltando = [
  ["PAINEL_URL", url],
  ["PAINEL_EMPRESA_SLUG", empresa],
  ["PAINEL_LEAD_CHAVE", chave],
]
  .filter(([, valor]) => !valor)
  .map(([nome]) => nome);

if (faltando.length > 0) {
  falhar(
    `Faltam variáveis de ambiente: ${faltando.join(", ")}.\n` +
      "   Sem elas o formulário do site continua funcionando normalmente, só não chega ao painel.",
  );
}

console.log(`Testando ${url}/api/webhooks/site/lead  (empresa: ${empresa}; chave: ${chave.length} caracteres)`);

const corta = new AbortController();
const relogio = setTimeout(() => corta.abort(), TEMPO_LIMITE_MS);

let resposta;
try {
  resposta = await fetch(`${url}/api/webhooks/site/lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Persi-Empresa": empresa,
      "X-Persi-Chave": chave,
      "X-Persi-Teste": "1",
    },
    // Dado fictício, só para passar na validação do painel.
    body: JSON.stringify({
      tipo: "formulario",
      contato: { nome: "Teste de conexão", email: "teste-conexao@persimateriais.com.br" },
      formulario: "teste de conexão (scripts/testar-painel-lead.mjs)",
    }),
    signal: corta.signal,
  });
} catch (erro) {
  const abortou = erro instanceof Error && erro.name === "AbortError";
  falhar(
    abortou
      ? `O painel não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos. Confira se PAINEL_URL está certo e se o painel está no ar.`
      : `Não consegui falar com o painel (${erro instanceof Error ? erro.message : "erro de rede"}). Confira PAINEL_URL.`,
  );
} finally {
  clearTimeout(relogio);
}

const corpo = await resposta.json().catch(() => ({}));

if (resposta.status === 200 && corpo.teste === true) {
  console.log("\nOK  Tudo certo: o painel autenticou o site e validou o formulário (nada foi gravado).");
  process.exit(0);
}
if (resposta.status === 201) {
  console.warn(
    "\n!  O painel respondeu 201: ele AINDA NÃO conhece o modo de teste e GRAVOU um lead de teste\n" +
      "   ('Teste de conexão'). A conexão e a chave estão certas, mas apague esse lead no painel\n" +
      "   e atualize o painel para a versão com suporte a X-Persi-Teste.",
  );
  process.exit(0);
}
if (resposta.status === 401) {
  falhar("401: o painel não aceitou a chave. Confira PAINEL_EMPRESA_SLUG e PAINEL_LEAD_CHAVE (a chave é por empresa e pode ter sido revogada).");
}
if (resposta.status === 403) {
  falhar("403: o módulo Clientes e funil (ou o rastreio) está desligado para essa empresa no painel.");
}
if (resposta.status === 400) {
  falhar(`400: o painel recusou o formato do teste (${JSON.stringify(corpo.campos ?? corpo)}). Avise quem mantém o painel.`);
}
if (resposta.status === 429) {
  falhar("429: muitas chamadas do mesmo endereço em pouco tempo. Espere um minuto e rode de novo.");
}
falhar(`O painel respondeu ${resposta.status}. Corpo: ${JSON.stringify(corpo)}`);
