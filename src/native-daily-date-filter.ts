export interface NativeDailyDateFilterContext {
  todayIso: string;
  fileName: string;
  filePath: string;
  fileDateIso?: string;
  properties?: Record<string, unknown>;
}

export type NativeDailyDateFilterResult =
  | { kind: "empty" }
  | { kind: "resolved"; dateIso: string; expression: string }
  | { kind: "invalid"; message: string };

const RECORD_DATE_OPERAND = /^(?:date\(\s*(?:note\.)?date\s*\)|(?:note\.)?date)$/iu;
const DURATION_SUFFIX = /\s*([+-])\s*(["'])([^"']+)\2\s*$/u;

function validIsoDate(value: unknown): string | null {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isoFromLooseDateValue(value: unknown): string | null {
  const direct = validIsoDate(value);
  if (direct) return direct;
  const match = String(value ?? "").match(/(?:^|[^0-9])(\d{4})[-/](\d{2})[-/](\d{2})(?:[^0-9]|$)/u);
  return match ? validIsoDate(`${match[1]}-${match[2]}-${match[3]}`) : null;
}

function isoDateToLocalDate(dateIso: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function localDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function applyDuration(dateIso: string, sign: string, duration: string): string | null {
  const match = duration.trim().match(/^(\d+)\s*(y|year|years|M|month|months|w|week|weeks|d|day|days|h|hour|hours|m|minute|minutes|s|second|seconds)$/u);
  if (!match) return null;
  const amount = Number(match[1]) * (sign === "-" ? -1 : 1);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  const date = isoDateToLocalDate(dateIso);
  if (unit === "y" || unit === "year" || unit === "years") {
    const day = date.getDate();
    date.setDate(1);
    date.setFullYear(date.getFullYear() + amount);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  } else if (unit === "M" || unit === "month" || unit === "months") {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + amount);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  }
  else if (unit === "w" || unit === "week" || unit === "weeks") date.setDate(date.getDate() + amount * 7);
  else if (unit === "d" || unit === "day" || unit === "days") date.setDate(date.getDate() + amount);
  else if (unit === "h" || unit === "hour" || unit === "hours") date.setHours(date.getHours() + amount);
  else if (unit === "m" || unit === "minute" || unit === "minutes") date.setMinutes(date.getMinutes() + amount);
  else date.setSeconds(date.getSeconds() + amount);
  return localDateToIso(date);
}

function propertyValue(context: NativeDailyDateFilterContext, path: string): unknown {
  const normalized = path.trim();
  if (normalized === "this.file.name") return context.fileDateIso || context.fileName;
  if (normalized === "this.file.path") return context.fileDateIso || context.filePath;
  const fileProperty = normalized.match(/^this\.file\.properties\.([A-Za-z0-9_-]+)$/u)?.[1];
  if (fileProperty) return context.properties?.[fileProperty];
  const property = normalized.match(/^this\.([A-Za-z0-9_-]+)$/u)?.[1];
  return property ? context.properties?.[property] : undefined;
}

function evaluateDatePrimary(expression: string, context: NativeDailyDateFilterContext): string | null {
  const value = expression.trim();
  if (/^(?:today\(\)|now\(\)(?:\.date\(\))?)$/iu.test(value)) return validIsoDate(context.todayIso);
  const dateCall = value.match(/^date\((.*)\)$/su);
  if (dateCall) return evaluateDateExpression(dateCall[1], context);
  const quoted = value.match(/^(["'])([\s\S]*)\1$/u);
  if (quoted) return isoFromLooseDateValue(quoted[2]);
  if (/^this\./u.test(value)) return isoFromLooseDateValue(propertyValue(context, value));
  return isoFromLooseDateValue(value);
}

function evaluateDateExpression(expression: string, context: NativeDailyDateFilterContext): string | null {
  let remaining = expression.trim();
  const operations: Array<{ sign: string; duration: string }> = [];
  while (true) {
    const suffix = remaining.match(DURATION_SUFFIX);
    if (!suffix || suffix.index == null) break;
    operations.unshift({ sign: suffix[1], duration: suffix[3] });
    remaining = remaining.slice(0, suffix.index).trim();
  }
  let dateIso = evaluateDatePrimary(remaining, context);
  if (!dateIso) return null;
  for (const operation of operations) {
    dateIso = applyDuration(dateIso, operation.sign, operation.duration);
    if (!dateIso) return null;
  }
  return dateIso;
}

function filterExpressions(source: string): string[] {
  return String(source || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^-[ \t]*/u, "").trim())
    .filter((line) => !/^(?:filters|and|or):$/iu.test(line))
    .filter((line) => line.includes("=="));
}

export function resolveNativeDailyDateFilter(
  source: string,
  context: NativeDailyDateFilterContext,
): NativeDailyDateFilterResult {
  if (!String(source || "").trim()) return { kind: "empty" };
  const expressions = filterExpressions(source);
  const dateExpressions = expressions.flatMap((expression) => {
    const operands = expression.split(/\s*==\s*/u);
    if (operands.length !== 2) return [];
    if (RECORD_DATE_OPERAND.test(operands[0])) return [{ expression, selector: operands[1] }];
    if (RECORD_DATE_OPERAND.test(operands[1])) return [{ expression, selector: operands[0] }];
    return [];
  });
  if (dateExpressions.length !== 1) {
    return { kind: "invalid", message: "Add exactly one Bases-style date equality filter." };
  }
  const selected = dateExpressions[0];
  const dateIso = evaluateDateExpression(selected.selector, context);
  if (!dateIso) {
    return { kind: "invalid", message: `Could not resolve the Health date from: ${selected.expression}` };
  }
  return { kind: "resolved", dateIso, expression: selected.expression };
}
