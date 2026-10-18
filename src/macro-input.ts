export const MACRO_KCAL_PER_GRAM = { proteinG: 4, carbsG: 4, fatG: 9, alcoholG: 7 } as const;
export type EnergyMacro = keyof typeof MACRO_KCAL_PER_GRAM;
export type MacroInputUnit = "g" | "kcal";

export function macroInputGrams(key: EnergyMacro, value: string, unit: MacroInputUnit): number | undefined {
  if (!value.trim()) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const grams = unit === "kcal" ? amount / MACRO_KCAL_PER_GRAM[key] : amount;
  return Number.isFinite(grams * MACRO_KCAL_PER_GRAM[key]) ? grams : undefined;
}

export function macroInputDisplay(key: EnergyMacro, grams: number | undefined, unit: MacroInputUnit): string {
  if (grams == null) return "";
  return String(Number((unit === "kcal" ? grams * MACRO_KCAL_PER_GRAM[key] : grams).toPrecision(12)));
}
