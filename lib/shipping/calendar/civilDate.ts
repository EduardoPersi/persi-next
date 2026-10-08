/**
 * Datas "de calendário" (sem hora e sem fuso) como texto `AAAA-MM-DD`.
 *
 * Todo o cálculo de prazo trabalha com elas, e não com `Date`, para o resultado
 * não depender do fuso do servidor (a Hostinger roda em UTC, a loja em
 * America/Sao_Paulo). Só `civilDateInSaoPaulo` converte um instante em data.
 */

export type CivilDate = string;

const STORE_TIME_ZONE = "America/Sao_Paulo";

export function parseCivilDate(date: CivilDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function formatCivilDate(year: number, month: number, day: number): CivilDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toUtcMs(date: CivilDate): number {
  const { year, month, day } = parseCivilDate(date);
  return Date.UTC(year, month - 1, day);
}

export function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(toUtcMs(date) + days * 86_400_000);
  return formatCivilDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(date: CivilDate): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

export function diffInDays(from: CivilDate, to: CivilDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

/** A segunda-feira da semana (a semana vai de segunda a domingo). */
export function mondayOf(date: CivilDate): CivilDate {
  const weekday = weekdayOf(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

function partsInSaoPaulo(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour"), minute: pick("minute") };
}

/** A data de hoje na loja (America/Sao_Paulo), qualquer que seja o fuso do servidor. */
export function civilDateInSaoPaulo(now: Date): CivilDate {
  const { year, month, day } = partsInSaoPaulo(now);
  return formatCivilDate(year, month, day);
}

/** Minutos desde a meia-noite na loja (America/Sao_Paulo). */
export function minutesOfDayInSaoPaulo(now: Date): number {
  const { hour, minute } = partsInSaoPaulo(now);
  return hour * 60 + minute;
}

/** "13:00" → 780. `null` se não for um horário HH:MM válido. */
export function parseTimeOfDay(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
