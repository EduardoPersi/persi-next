/**
 * FERIADOS: nacionais, estaduais e municipais, vindos de uma lista (CSV) que o
 * painel de administração vai poder importar. Código puro, sem acesso a arquivo
 * nem a rede.
 *
 * Formato do CSV (primeira linha = cabeçalho; `;` ou `,`; UTF-8, com ou sem BOM):
 *
 *   data;nome;escopo;uf;cidade;facultativo
 *   25/12;Natal;nacional;;;
 *   09/07;Revolução Constitucionalista;estadual;SP;;
 *   15/08;Nossa Senhora do Desterro;municipal;SP;Jundiaí;
 *   04/06/2026;Corpus Christi;nacional;;;sim
 *
 *   data        DD/MM/AAAA, AAAA-MM-DD (um ano só), DD/MM (todo ano) ou, para
 *               o que depende da Páscoa, "Corpus Christi", "Sexta-feira Santa",
 *               "Carnaval segunda" ou "Carnaval terça" (calculado a cada ano)
 *   nome        texto livre
 *   escopo      nacional | estadual | municipal (se vazio: com cidade = municipal,
 *               só com UF = estadual, senão nacional)
 *   uf          sigla do estado (obrigatória em estadual)
 *   cidade      obrigatória em municipal
 *   facultativo sim/não — ponto facultativo NÃO conta como feriado (padrão)
 *
 * Os feriados que mudam de data com a Páscoa (Sexta-feira Santa, Carnaval e
 * Corpus Christi) são calculados aqui (`feriadosMoveis`), sem precisar listar.
 */

import { addDays, formatCivilDate, isValidCivilDate, parseCivilDate, type CivilDate } from "./civilDate.ts";

export type HolidayScope = "nacional" | "estadual" | "municipal";

/** Feriados que mudam de data a cada ano, calculados a partir da Páscoa. */
export type MovableHoliday = "sexta-santa" | "carnaval-segunda" | "carnaval-terca" | "corpus-christi";

const MOVABLE_OFFSETS: Record<MovableHoliday, number> = {
  "sexta-santa": -2,
  "carnaval-segunda": -48,
  "carnaval-terca": -47,
  "corpus-christi": 60,
};

export interface Holiday {
  /** Com `movable`, month e day são ignorados (use 0). */
  month: number;
  day: number;
  /** Ausente = vale todo ano. */
  year?: number;
  /** Data calculada pela Páscoa (ex.: Corpus Christi de uma cidade). */
  movable?: MovableHoliday;
  name: string;
  scope: HolidayScope;
  uf?: string;
  city?: string;
  /** Ponto facultativo: só conta se `countOptional` for verdadeiro. */
  optional?: boolean;
}

export interface HolidayCsvError {
  line: number;
  message: string;
}

export interface HolidayCsvResult {
  holidays: Holiday[];
  errors: HolidayCsvError[];
}

export const BRAZILIAN_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Sem acento, minúsculo e com espaços simples: "Jundiaí " → "jundiai". */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

const COLUMN_ALIASES: Record<string, string[]> = {
  data: ["data", "date", "dia"],
  nome: ["nome", "feriado", "name", "descricao"],
  escopo: ["escopo", "tipo", "nivel", "abrangencia"],
  uf: ["uf", "estado"],
  cidade: ["cidade", "municipio"],
  facultativo: ["facultativo", "ponto facultativo"],
};

function columnIndexes(header: string[]): Record<string, number> {
  const normalized = header.map(normalizeText);
  const indexes: Record<string, number> = {};
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = normalized.findIndex((name) => aliases.includes(name));
    if (found >= 0) indexes[column] = found;
  }
  return indexes;
}

const MOVABLE_NAMES: Record<string, MovableHoliday> = {
  "sexta-feira santa": "sexta-santa",
  "sexta santa": "sexta-santa",
  "carnaval segunda": "carnaval-segunda",
  "carnaval terca": "carnaval-terca",
  "corpus christi": "corpus-christi",
};

function parseDate(
  text: string,
): { month: number; day: number; year?: number; movable?: MovableHoliday } | null {
  const movable = MOVABLE_NAMES[normalizeText(text)];
  if (movable) return { month: 0, day: 0, movable };
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidCivilDate(year, month, day) ? { month, day, year } : null;
  }
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidCivilDate(year, month, day) ? { month, day, year } : null;
  }
  match = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (match) {
    const [day, month] = [Number(match[1]), Number(match[2])];
    // Validado num ano bissexto (2024) só para a data existir; "todo ano" não
    // tem ano fixo. 29/02, por existir só em ano bissexto, simplesmente não
    // casa nos demais.
    return isValidCivilDate(2024, month, day) ? { month, day } : null;
  }
  return null;
}

const YES = new Set(["sim", "s", "true", "1", "x", "yes"]);

export function parseHolidayCsv(csv: string): HolidayCsvResult {
  const holidays: Holiday[] = [];
  const errors: HolidayCsvError[] = [];
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);

  const headerIndex = lines.findIndex((line) => line.trim() !== "");
  if (headerIndex < 0) return { holidays, errors: [{ line: 1, message: "O arquivo está vazio." }] };

  const delimiter = (lines[headerIndex].match(/;/g)?.length ?? 0) >= (lines[headerIndex].match(/,/g)?.length ?? 0) ? ";" : ",";
  const columns = columnIndexes(splitCsvLine(lines[headerIndex], delimiter));
  if (columns.data === undefined || columns.nome === undefined) {
    return {
      holidays,
      errors: [{ line: headerIndex + 1, message: 'O cabeçalho precisa ter as colunas "data" e "nome".' }],
    };
  }

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim() === "") continue;
    const lineNumber = index + 1;
    const cells = splitCsvLine(raw, delimiter);
    const cell = (column: string) => (columns[column] === undefined ? "" : (cells[columns[column]] ?? ""));

    const date = parseDate(cell("data"));
    if (!date) {
      errors.push({ line: lineNumber, message: `Data inválida: "${cell("data")}". Use DD/MM/AAAA, AAAA-MM-DD ou DD/MM.` });
      continue;
    }
    const name = cell("nome");
    if (!name) {
      errors.push({ line: lineNumber, message: "O nome do feriado está vazio." });
      continue;
    }

    const uf = cell("uf").toUpperCase();
    const city = cell("cidade");
    let scope: HolidayScope;
    const scopeText = normalizeText(cell("escopo"));
    if (scopeText === "") scope = city ? "municipal" : uf ? "estadual" : "nacional";
    else if (scopeText === "nacional" || scopeText === "estadual" || scopeText === "municipal") scope = scopeText;
    else {
      errors.push({ line: lineNumber, message: `Escopo inválido: "${cell("escopo")}". Use nacional, estadual ou municipal.` });
      continue;
    }

    if (uf && !(BRAZILIAN_UFS as readonly string[]).includes(uf)) {
      errors.push({ line: lineNumber, message: `UF inválida: "${cell("uf")}".` });
      continue;
    }
    if (scope === "estadual" && !uf) {
      errors.push({ line: lineNumber, message: "Feriado estadual precisa da UF." });
      continue;
    }
    if (scope === "municipal" && !city) {
      errors.push({ line: lineNumber, message: "Feriado municipal precisa da cidade." });
      continue;
    }

    holidays.push({
      ...date,
      name,
      scope,
      ...(scope !== "nacional" && uf ? { uf } : {}),
      ...(scope === "municipal" ? { city } : {}),
      ...(YES.has(normalizeText(cell("facultativo"))) ? { optional: true } : {}),
    });
  }
  return { holidays, errors };
}

// ---------------------------------------------------------------------------
// Feriados que dependem da Páscoa
// ---------------------------------------------------------------------------

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatCivilDate(year, month, day);
}

/**
 * Sexta-feira Santa (feriado nacional), Carnaval (segunda e terça) e Corpus
 * Christi. Os três últimos são PONTO FACULTATIVO nacional: só contam se a
 * cidade os tratar como feriado, o que se diz na lista (CSV) com uma linha
 * `DD/MM/AAAA;Corpus Christi;municipal;SP;Jundiaí;` — sem "facultativo".
 */
export function feriadosMoveis(year: number): Holiday[] {
  const easter = easterSunday(year);
  const make = (date: CivilDate, name: string, optional: boolean): Holiday => {
    const { month, day } = parseCivilDate(date);
    return { month, day, year, name, scope: "nacional", ...(optional ? { optional: true } : {}) };
  };
  return [
    make(addDays(easter, -2), "Sexta-feira Santa", false),
    make(addDays(easter, -48), "Carnaval (segunda)", true),
    make(addDays(easter, -47), "Carnaval (terça)", true),
    make(addDays(easter, 60), "Corpus Christi", true),
  ];
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export interface HolidayPlace {
  uf?: string;
  city?: string;
}

export interface HolidayLookupOptions {
  /** Conta o ponto facultativo como feriado. Padrão: não. */
  countOptional?: boolean;
}

function holidayAppliesTo(holiday: Holiday, place: HolidayPlace): boolean {
  if (holiday.scope === "nacional") return true;
  if (holiday.scope === "estadual") {
    return Boolean(place.uf) && holiday.uf === place.uf?.toUpperCase();
  }
  if (!place.city || !holiday.city) return false;
  if (normalizeText(holiday.city) !== normalizeText(place.city)) return false;
  return !holiday.uf || !place.uf || holiday.uf === place.uf.toUpperCase();
}

/**
 * O feriado que cai nesta data para este lugar (ou `null`). Junta a lista com
 * os feriados móveis do ano. `places` aceita vários lugares (a loja e o
 * destino): vale se for feriado em qualquer um.
 */
export function findHoliday(
  date: CivilDate,
  holidays: readonly Holiday[],
  places: readonly HolidayPlace[],
  options: HolidayLookupOptions = {},
): Holiday | null {
  const { year, month, day } = parseCivilDate(date);
  const easter = easterSunday(year);
  const candidates = [...holidays, ...feriadosMoveis(year)];
  for (const holiday of candidates) {
    if (holiday.movable) {
      if (addDays(easter, MOVABLE_OFFSETS[holiday.movable]) !== date) continue;
    } else {
      if (holiday.month !== month || holiday.day !== day) continue;
      if (holiday.year !== undefined && holiday.year !== year) continue;
    }
    if (holiday.optional && !options.countOptional) continue;
    if (places.some((place) => holidayAppliesTo(holiday, place))) return holiday;
  }
  return null;
}
