// Motor de regras compartilhado (order bump, mensagens condicionais, descontos
// e automações do CRM). Código puro e sem dependências, para rodar igual no
// servidor, no cliente e nos testes com `node --test`.
//
// Estrutura: `groups` é uma lista de grupos combinados com OU; as linhas dentro
// de cada grupo são combinadas com E. Sem grupos (ou só grupos vazios) a regra
// não restringe nada e retorna true. Tipo, operador ou valor desconhecido
// nunca casa (falha fechada), para uma regra malformada não liberar uma oferta.

export type RuleOperator = "==" | "!=" | ">=" | "<=";

export type RuleConditionType =
  | "subtotal"
  | "item_count"
  | "weight"
  | "product"
  | "category"
  | "tag"
  | "coupon"
  | "payment_method"
  | "shipping_method"
  | "postcode"
  | "city"
  | "state"
  | "logged_in"
  | "date"
  | "weekday"
  | "hour";

export interface RuleCondition {
  type: RuleConditionType | (string & {});
  op: RuleOperator | (string & {});
  value: string | number | boolean;
}

export type RuleGroups = RuleCondition[][];

export interface RuleContext {
  subtotal?: number;
  itemCount?: number;
  weight?: number;
  productIds?: Array<string | number>;
  categories?: string[];
  tags?: string[];
  coupons?: string[];
  paymentMethod?: string;
  shippingMethod?: string;
  postcode?: string;
  city?: string;
  state?: string;
  isLoggedIn?: boolean;
  now?: Date;
}

const STORE_TIME_ZONE = "America/Sao_Paulo";

const NUMERIC_TYPES = new Set<string>(["subtotal", "item_count", "weight"]);
const LIST_TYPES = new Set<string>(["product", "category", "tag", "coupon"]);

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function compareNumbers(actual: number, op: string, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  switch (op) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">=":
      return actual >= expected;
    case "<=":
      return actual <= expected;
    default:
      return false;
  }
}

function compareStrings(actual: string, op: string, expected: string): boolean {
  if (op === "==") return actual === expected;
  if (op === "!=") return actual !== expected;
  return false;
}

function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

// "132" casa por prefixo; "13200000-13219999" casa por faixa de CEP completo.
function postcodeMatches(actual: string, expected: string): boolean {
  const postcode = digitsOnly(actual);
  if (!postcode) return false;

  const range = expected.match(/^\s*(\d{8})\s*-\s*(\d{8})\s*$/);
  if (range) {
    if (postcode.length !== 8) return false;
    const numeric = Number(postcode);
    return numeric >= Number(range[1]) && numeric <= Number(range[2]);
  }

  const prefix = digitsOnly(expected);
  return prefix.length > 0 && postcode.startsWith(prefix);
}

function getStoreDateParts(now: Date): {
  date: string;
  weekday: number;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    weekday: weekdays.indexOf(pick("weekday")),
    hour: Number(pick("hour")),
  };
}

function matchesCondition(
  condition: RuleCondition,
  context: RuleContext,
): boolean {
  const { type, op, value } = condition;

  if (NUMERIC_TYPES.has(type)) {
    const actual =
      type === "subtotal"
        ? context.subtotal
        : type === "item_count"
          ? context.itemCount
          : context.weight;
    if (actual === undefined) return false;
    return compareNumbers(actual, op, Number(value));
  }

  if (LIST_TYPES.has(type)) {
    if (op !== "==" && op !== "!=") return false;
    const list =
      type === "product"
        ? context.productIds
        : type === "category"
          ? context.categories
          : type === "tag"
            ? context.tags
            : context.coupons;
    if (!list) return false;
    const expected = normalizeText(value);
    const contains = list.some((entry) => normalizeText(entry) === expected);
    return op === "==" ? contains : !contains;
  }

  switch (type) {
    case "payment_method":
      return compareStrings(
        normalizeText(context.paymentMethod),
        op,
        normalizeText(value),
      );
    case "shipping_method":
      return compareStrings(
        normalizeText(context.shippingMethod),
        op,
        normalizeText(value),
      );
    case "city":
      return compareStrings(
        normalizeText(context.city),
        op,
        normalizeText(value),
      );
    case "state":
      return compareStrings(
        normalizeText(context.state),
        op,
        normalizeText(value),
      );
    case "postcode": {
      if (op !== "==" && op !== "!=") return false;
      if (!context.postcode) return false;
      const matched = postcodeMatches(context.postcode, String(value));
      return op === "==" ? matched : !matched;
    }
    case "logged_in": {
      if (context.isLoggedIn === undefined) return false;
      return compareStrings(
        String(context.isLoggedIn),
        op,
        normalizeText(value),
      );
    }
    case "date": {
      const { date } = getStoreDateParts(context.now ?? new Date());
      const expected = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) return false;
      if (op === "==") return date === expected;
      if (op === "!=") return date !== expected;
      if (op === ">=") return date >= expected;
      if (op === "<=") return date <= expected;
      return false;
    }
    case "weekday": {
      const { weekday } = getStoreDateParts(context.now ?? new Date());
      return compareNumbers(weekday, op, Number(value));
    }
    case "hour": {
      const { hour } = getStoreDateParts(context.now ?? new Date());
      return compareNumbers(hour, op, Number(value));
    }
    default:
      return false;
  }
}

export function matchConditions(
  groups: RuleGroups | null | undefined,
  context: RuleContext,
): boolean {
  const activeGroups = (groups ?? []).filter(
    (group) => Array.isArray(group) && group.length > 0,
  );
  if (activeGroups.length === 0) return true;

  return activeGroups.some((group) =>
    group.every((condition) => matchesCondition(condition, context)),
  );
}
