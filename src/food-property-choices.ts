import { foodEntryPortion, foodMetricServing } from './food-serving';

/** Metadata-only adapter for GCM. The same portion resolver owns native totals. */
export const foodServingChoices = {
  label: 'Food servings',
  sourceProperties: ['servingAmount', 'servingUnit', 'servingGrams', 'servingMl'],
  getChoices(food: Record<string, unknown>): Array<{ value: string; label: string; aliases?: string[] }> {
    if (!this.sourceProperties.some((key: string) => food[key] != null)) return [];
    const raw = String(food.servingUnit || 'serving').trim().toLowerCase().replace(/\s+/g, ' ');
    const amount = Number(food.servingAmount);
    if (food.servingAmount != null && (!Number.isFinite(amount) || amount <= 0 || typeof food.servingAmount === 'boolean')) return [];
    const size = amount > 0 ? amount : 1;
    const metric = foodMetricServing(food);
    const format = (value: number) => String(Math.round(value * 10000) / 10000);
    const label = `${format(size)} ${raw}`;
    const metricLabel = metric ? `${format(metric.amount)} ${metric.unit}` : '';
    const units = [raw, 'serving', ...(metric?.unit === 'g' ? ['g', 'oz'] : metric?.unit === 'ml' ? ['ml', 'fl oz', 'cup'] : [])];
    const aliases: Record<string, string[]> = { g: ['gram', 'grams'], ml: ['milliliter', 'milliliters'], oz: ['ounce', 'ounces'], 'fl oz': ['fluid ounce', 'fluid ounces'], cup: ['cups'] };
    return [...new Set(units)].filter(unit => foodEntryPortion({quantity: 1, unit}, food)).map(value => ({
      value,
      label: value === 'serving' ? `serving · ${label}${metricLabel && raw !== metric?.unit ? ` (${metricLabel})` : ''}`
        : value === raw ? `${value} · label: ${label}${metricLabel && raw !== metric?.unit ? ` (${metricLabel})` : ''}`
        : `${value} · label: ${metricLabel}`,
      aliases: [...(aliases[value] || []), ...(value.length > 1 && value.endsWith('s') ? [value.slice(0, -1)] : [value + 's'])]
        .filter(unit => !!foodEntryPortion({quantity: 1, unit}, food)),
    }));
  },
};
