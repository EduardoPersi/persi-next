import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  civilDateInSaoPaulo,
  diffInDays,
  isValidCivilDate,
  minutesOfDayInSaoPaulo,
  mondayOf,
  parseTimeOfDay,
  weekdayOf,
} from "../lib/shipping/calendar/civilDate.ts";
import {
  easterSunday,
  feriadosMoveis,
  findHoliday,
  parseHolidayCsv,
} from "../lib/shipping/calendar/holidays.ts";
import {
  addBusinessDays,
  dispatchDate,
  estimateCarrierArrival,
  estimateOwnDeliveryArrival,
  formatArrival,
  isOperatingDay,
} from "../lib/shipping/calendar/deliveryDate.ts";

// Hora de São Paulo é UTC-3 (sem horário de verão desde 2019).
const sp = (iso) => new Date(`${iso}-03:00`);

const LISTA = [
  { month: 10, day: 12, name: "Nossa Senhora Aparecida", scope: "nacional" },
  { month: 11, day: 2, name: "Finados", scope: "nacional" },
  { month: 7, day: 9, name: "Revolução Constitucionalista", scope: "estadual", uf: "SP" },
  { month: 8, day: 15, name: "Nossa Senhora do Desterro", scope: "municipal", uf: "SP", city: "Jundiaí" },
  { month: 10, day: 8, year: 2026, name: "Aniversário de Itatiba (teste)", scope: "municipal", uf: "SP", city: "Itatiba" },
];
const contexto = { holidays: LISTA };

// ----- datas de calendário -----

test("datas de calendário: soma, dia da semana, segunda-feira e diferença", () => {
  assert.equal(addDays("2026-10-07", 1), "2026-10-08");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(weekdayOf("2026-10-07"), 3);
  assert.equal(weekdayOf("2026-10-10"), 6);
  assert.equal(mondayOf("2026-10-07"), "2026-10-05");
  assert.equal(mondayOf("2026-10-11"), "2026-10-05");
  assert.equal(diffInDays("2026-10-07", "2026-10-23"), 16);
  assert.equal(isValidCivilDate(2026, 2, 31), false);
  assert.equal(isValidCivilDate(2024, 2, 29), true);
  assert.equal(isValidCivilDate(2026, 2, 29), false);
});

test("a data de hoje é a de São Paulo, não a do servidor (UTC)", () => {
  const instante = new Date("2026-10-08T01:30:00Z");
  assert.equal(civilDateInSaoPaulo(instante), "2026-10-07");
  assert.equal(minutesOfDayInSaoPaulo(instante), 22 * 60 + 30);
});

test("horário HH:MM", () => {
  assert.equal(parseTimeOfDay("13:00"), 780);
  assert.equal(parseTimeOfDay("9:05"), 545);
  assert.equal(parseTimeOfDay("25:00"), null);
  assert.equal(parseTimeOfDay("treze"), null);
});

// ----- CSV de feriados -----

test("CSV com ponto e vírgula, datas nos três formatos e escopo deduzido", () => {
  const csv = [
    "data;nome;escopo;uf;cidade;facultativo",
    "25/12;Natal;;;;",
    "09/07;Revolução Constitucionalista;;SP;;",
    "15/08;Nossa Senhora do Desterro;;SP;Jundiaí;",
    "04/06/2026;Corpus Christi;municipal;SP;Jundiaí;sim",
    "2027-03-01;Dia especial;nacional;;;",
  ].join("\n");
  const { holidays, errors } = parseHolidayCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(holidays.length, 5);
  assert.deepEqual(holidays[0], { month: 12, day: 25, name: "Natal", scope: "nacional" });
  assert.equal(holidays[1].scope, "estadual");
  assert.equal(holidays[1].uf, "SP");
  assert.equal(holidays[2].scope, "municipal");
  assert.equal(holidays[2].city, "Jundiaí");
  assert.equal(holidays[3].year, 2026);
  assert.equal(holidays[3].optional, true);
  assert.equal(holidays[4].year, 2027);
});

test("CSV com vírgula, BOM, aspas e cabeçalho com acento ou outra ordem", () => {
  const csv = '﻿Município,Feriado,Data,UF\r\n"Várzea Paulista","Dia da Cidade, teste",12/10,SP\r\n';
  const { holidays, errors } = parseHolidayCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(holidays.length, 1);
  assert.equal(holidays[0].name, "Dia da Cidade, teste");
  assert.equal(holidays[0].city, "Várzea Paulista");
  assert.equal(holidays[0].scope, "municipal");
});

test("CSV acusa cada linha ruim, com o número da linha, e aproveita as boas", () => {
  const csv = [
    "data;nome;escopo;uf;cidade",
    "31/02;Data impossível;nacional;;",
    "10/10;;nacional;;",
    "11/10;Sem cidade;municipal;SP;",
    "12/10;Sem UF;estadual;;",
    "13/10;UF errada;estadual;ZZ;",
    "14/10;Escopo errado;regional;;",
    "15/10;Boa;nacional;;",
  ].join("\n");
  const { holidays, errors } = parseHolidayCsv(csv);
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4, 5, 6, 7]);
  assert.equal(holidays.length, 1);
  assert.equal(holidays[0].name, "Boa");
});

test("CSV vazio ou sem as colunas obrigatórias", () => {
  assert.equal(parseHolidayCsv("").errors.length, 1);
  assert.match(parseHolidayCsv("a;b\n1;2").errors[0].message, /data/);
});

// ----- Páscoa e feriados móveis -----

test("Páscoa e feriados que dependem dela", () => {
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2025), "2025-04-20");
  const moveis = feriadosMoveis(2026);
  const por = (nome) => moveis.find((h) => h.name === nome);
  assert.deepEqual([por("Sexta-feira Santa").month, por("Sexta-feira Santa").day], [4, 3]);
  assert.deepEqual([por("Carnaval (terça)").month, por("Carnaval (terça)").day], [2, 17]);
  assert.deepEqual([por("Corpus Christi").month, por("Corpus Christi").day], [6, 4]);
  assert.equal(por("Sexta-feira Santa").optional, undefined);
  assert.equal(por("Corpus Christi").optional, true);
});

// ----- consulta de feriado -----

test("feriado nacional vale em qualquer cidade; estadual só na UF; municipal só na cidade", () => {
  const jundiai = { uf: "SP", city: "Jundiaí" };
  assert.equal(findHoliday("2026-10-12", LISTA, [{}])?.name, "Nossa Senhora Aparecida");
  assert.equal(findHoliday("2026-07-09", LISTA, [jundiai])?.scope, "estadual");
  assert.equal(findHoliday("2026-07-09", LISTA, [{ uf: "RJ" }]), null);
  assert.equal(findHoliday("2026-08-15", LISTA, [jundiai])?.city, "Jundiaí");
  assert.equal(findHoliday("2026-08-15", LISTA, [{ uf: "SP", city: "Itupeva" }]), null);
});

test("a cidade é comparada sem acento nem maiúscula", () => {
  assert.ok(findHoliday("2026-08-15", LISTA, [{ uf: "sp", city: "JUNDIAI" }]));
  assert.ok(findHoliday("2026-08-15", LISTA, [{ city: " jundiaí " }]));
});

test("feriado de um ano só não vale nos outros anos", () => {
  const itatiba = { uf: "SP", city: "Itatiba" };
  assert.ok(findHoliday("2026-10-08", LISTA, [itatiba]));
  assert.equal(findHoliday("2027-10-08", LISTA, [itatiba]), null);
});

test("ponto facultativo não conta, a menos que se peça", () => {
  assert.equal(findHoliday("2026-06-04", [], [{}]), null);
  assert.equal(findHoliday("2026-06-04", [], [{}], { countOptional: true })?.name, "Corpus Christi");
  assert.equal(findHoliday("2026-04-03", [], [{}])?.name, "Sexta-feira Santa");
});

test("a cidade pode declarar Corpus Christi como feriado dela, sem 'facultativo'", () => {
  const lista = [{ month: 6, day: 4, year: 2026, name: "Corpus Christi", scope: "municipal", uf: "SP", city: "Jundiaí" }];
  assert.ok(findHoliday("2026-06-04", lista, [{ uf: "SP", city: "Jundiaí" }]));
  assert.equal(findHoliday("2026-06-04", lista, [{ uf: "SP", city: "Itu" }]), null);
});

// ----- horário de corte e despacho -----

test("dias de operação: segunda a sábado, menos feriado", () => {
  assert.equal(isOperatingDay("2026-10-07", contexto), true);
  assert.equal(isOperatingDay("2026-10-10", contexto), true);
  assert.equal(isOperatingDay("2026-10-11", contexto), false);
  assert.equal(isOperatingDay("2026-10-12", contexto), false);
});

test("corte de 13h nos dias de semana: antes sai hoje, a partir das 13h sai no próximo dia", () => {
  assert.equal(dispatchDate(sp("2026-10-07T10:00:00"), contexto), "2026-10-07");
  assert.equal(dispatchDate(sp("2026-10-07T12:59:00"), contexto), "2026-10-07");
  assert.equal(dispatchDate(sp("2026-10-07T13:00:00"), contexto), "2026-10-08");
  assert.equal(dispatchDate(sp("2026-10-07T18:30:00"), contexto), "2026-10-08");
});

test("corte de 10h no sábado; depois dele, o próximo dia útil pula o feriado de segunda", () => {
  assert.equal(dispatchDate(sp("2026-10-10T09:59:00"), contexto), "2026-10-10");
  // Sábado 10h: domingo não opera e segunda 12/10 é feriado → terça 13/10.
  assert.equal(dispatchDate(sp("2026-10-10T10:00:00"), contexto), "2026-10-13");
});

test("pedido no domingo ou em feriado da loja sai no próximo dia de operação", () => {
  assert.equal(dispatchDate(sp("2026-10-11T09:00:00"), contexto), "2026-10-13");
  assert.equal(dispatchDate(sp("2026-10-12T09:00:00"), contexto), "2026-10-13");
});

test("o fuso do servidor não muda o corte: 22h30 em São Paulo é 01h30 UTC do dia seguinte", () => {
  assert.equal(dispatchDate(new Date("2026-10-08T01:30:00Z"), contexto), "2026-10-08");
});

test("o horário de corte pode ser trocado (e um valor inválido volta ao padrão)", () => {
  const tarde = { ...contexto, cutoff: { weekday: "16:00", saturday: "12:00" } };
  assert.equal(dispatchDate(sp("2026-10-07T15:00:00"), tarde), "2026-10-07");
  const quebrado = { ...contexto, cutoff: { weekday: "quando der", saturday: "?" } };
  assert.equal(dispatchDate(sp("2026-10-07T12:00:00"), quebrado), "2026-10-07");
  assert.equal(dispatchDate(sp("2026-10-07T14:00:00"), quebrado), "2026-10-08");
});

// ----- prazo de transportadora -----

test("dias úteis pulam sábado, domingo e feriado", () => {
  assert.equal(addBusinessDays("2026-10-08", 2, contexto), "2026-10-13");
  assert.equal(addBusinessDays("2026-10-07", 0, contexto), "2026-10-07");
  assert.equal(addBusinessDays("2026-10-07", 2, contexto), "2026-10-09");
});

test("feriado municipal do DESTINO também atrasa a entrega", () => {
  // 08/10/2026 é feriado em Itatiba (lista de teste): de 07/10, 1 dia útil vira sexta 09/10.
  assert.equal(addBusinessDays("2026-10-07", 1, contexto, { uf: "SP", city: "Itatiba" }), "2026-10-09");
  assert.equal(addBusinessDays("2026-10-07", 1, contexto, { uf: "SP", city: "Itu" }), "2026-10-08");
});

test("previsão de transportadora: pedido de manhã chega em 2 dias úteis", () => {
  const chegada = estimateCarrierArrival(sp("2026-10-07T10:00:00"), 2, contexto);
  assert.equal(chegada, "2026-10-09");
  assert.equal(formatArrival(chegada, "2026-10-07"), "Chega sexta, dia 9");
});

test("previsão de transportadora: pedido depois do corte, com feriado no caminho", () => {
  const chegada = estimateCarrierArrival(sp("2026-10-07T14:00:00"), 2, contexto);
  assert.equal(chegada, "2026-10-13");
  assert.equal(formatArrival(chegada, "2026-10-07"), "Chega até a próxima terça, dia 13");
});

// ----- entrega própria -----

test("entrega própria no mesmo dia (antes do corte) e no dia seguinte (depois dele)", () => {
  assert.equal(estimateOwnDeliveryArrival(sp("2026-10-07T10:00:00"), 0, contexto), "2026-10-07");
  assert.equal(estimateOwnDeliveryArrival(sp("2026-10-07T14:00:00"), 0, contexto), "2026-10-08");
});

test("entrega própria conta o sábado como dia de operação e pula o feriado", () => {
  // Sexta 14h: sai no sábado 10/10; +1 dia de operação = segunda 12/10 (feriado) → terça 13/10.
  assert.equal(estimateOwnDeliveryArrival(sp("2026-10-09T14:00:00"), 1, contexto), "2026-10-13");
  // Sexta 09h sai na própria sexta; +1 dia de operação = sábado 10/10.
  assert.equal(estimateOwnDeliveryArrival(sp("2026-10-09T09:00:00"), 1, contexto), "2026-10-10");
});

// ----- o texto -----

test("textos de previsão no jeito que o cliente fala", () => {
  const hoje = "2026-10-07"; // quarta-feira
  assert.equal(formatArrival("2026-10-07", hoje), "Chega hoje");
  assert.equal(formatArrival("2026-10-08", hoje), "Chega amanhã, dia 8");
  assert.equal(formatArrival("2026-10-09", hoje), "Chega sexta, dia 9");
  assert.equal(formatArrival("2026-10-11", hoje), "Chega domingo, dia 11");
  assert.equal(formatArrival("2026-10-12", hoje), "Chega até a próxima segunda, dia 12");
  assert.equal(formatArrival("2026-10-13", hoje), "Chega até a próxima terça, dia 13");
  assert.equal(formatArrival("2026-10-18", hoje), "Chega até a próxima domingo, dia 18");
  assert.equal(formatArrival("2026-10-23", hoje), "Chega até sexta, dia 23 de outubro");
  assert.equal(formatArrival("2026-12-02", hoje), "Chega até quarta, dia 2 de dezembro");
});

test("data no passado ou igual a hoje vira 'Chega hoje'", () => {
  assert.equal(formatArrival("2026-10-01", "2026-10-07"), "Chega hoje");
});

// ----- feriados que dependem da Páscoa, por cidade -----

test("Corpus Christi por cidade no CSV: data móvel calculada todo ano", () => {
  const csv = "data;nome;escopo;uf;cidade\nCorpus Christi;Corpus Christi;municipal;SP;Jundiaí\n";
  const { holidays, errors } = parseHolidayCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(holidays[0].movable, "corpus-christi");
  const jundiai = { uf: "SP", city: "Jundiaí" };
  assert.ok(findHoliday("2026-06-04", holidays, [jundiai]));
  assert.ok(findHoliday("2027-05-27", holidays, [jundiai]));
  assert.equal(findHoliday("2026-06-04", holidays, [{ uf: "SP", city: "Itu" }]), null);
  assert.equal(findHoliday("2026-06-05", holidays, [jundiai]), null);
});

// ----- a lista padrão da Persi -----

test("a lista padrão da Persi lê sem nenhum erro", async () => {
  const { DEFAULT_HOLIDAYS_CSV } = await import("../lib/shipping/calendar/holidaysDefault.ts");
  const { holidays, errors } = parseHolidayCsv(DEFAULT_HOLIDAYS_CSV);
  assert.deepEqual(errors, []);
  assert.ok(holidays.length > 40);
});

test("lista padrão: conferências por cidade (fonte: calendário do TJSP 2026)", async () => {
  const { DEFAULT_HOLIDAYS_CSV } = await import("../lib/shipping/calendar/holidaysDefault.ts");
  const { holidays } = parseHolidayCsv(DEFAULT_HOLIDAYS_CSV);
  const em = (data, cidade) => findHoliday(data, holidays, [{ uf: "SP", city: cidade }]);
  assert.ok(em("2026-08-15", "Jundiaí"), "padroeira de Jundiaí");
  assert.equal(em("2026-12-14", "Jundiaí"), null, "14/12 é de site de calendário, contradiz o decreto");
  assert.ok(em("2026-06-04", "Jundiaí"), "Corpus Christi em Jundiaí");
  assert.equal(em("2026-06-04", "Cabreúva"), null, "Cabreúva não tem Corpus Christi no TJSP");
  assert.equal(em("2026-06-04", "Várzea Paulista"), null);
  assert.ok(em("2026-06-04", "Itu"));
  assert.ok(em("2026-10-07", "Campo Limpo Paulista"), "padroeira de Campo Limpo");
  assert.equal(em("2026-10-07", "Jundiaí"), null);
  assert.ok(em("2026-09-08", "Itatiba"));
  assert.ok(em("2026-01-25", "São Paulo"), "Perus segue a capital");
  assert.equal(em("2026-12-08", "Franco da Rocha"), null, "08/12 não está confirmado");
  assert.equal(em("2026-12-30", "Valinhos"), null, "30/12 só em site de calendário");
});

test("lista padrão: nacionais fixos e o 9 de julho paulista; Carnaval e Corpus Christi nacionais não contam", async () => {
  const { DEFAULT_HOLIDAYS_CSV } = await import("../lib/shipping/calendar/holidaysDefault.ts");
  const { holidays } = parseHolidayCsv(DEFAULT_HOLIDAYS_CSV);
  const sem = [{}];
  for (const data of ["2026-01-01", "2026-04-21", "2026-05-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"]) {
    assert.ok(findHoliday(data, holidays, sem), data);
  }
  assert.ok(findHoliday("2026-07-09", holidays, [{ uf: "SP" }]));
  assert.equal(findHoliday("2026-07-09", holidays, [{ uf: "RJ" }]), null);
  assert.ok(findHoliday("2026-04-03", holidays, sem), "Sexta-feira Santa");
  assert.equal(findHoliday("2026-02-17", holidays, sem), null, "Carnaval é ponto facultativo");
  assert.equal(findHoliday("2026-06-04", holidays, sem), null, "Corpus Christi só vale onde a cidade o declara");
});

test("com a lista padrão, um pedido para Cabreúva chega antes de um para Itu na semana do Corpus Christi", async () => {
  const { DEFAULT_HOLIDAYS_CSV } = await import("../lib/shipping/calendar/holidaysDefault.ts");
  const { holidays } = parseHolidayCsv(DEFAULT_HOLIDAYS_CSV);
  const ctx = { holidays };
  // Terça 02/06/2026, 10h: sai na terça; 3 dias úteis.
  const agora = sp("2026-06-02T10:00:00");
  const cabreuva = estimateCarrierArrival(agora, 3, ctx, { uf: "SP", city: "Cabreúva" });
  const itu = estimateCarrierArrival(agora, 3, ctx, { uf: "SP", city: "Itu" });
  assert.equal(cabreuva, "2026-06-05");
  assert.equal(itu, "2026-06-08");
});