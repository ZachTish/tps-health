/** Obsidian tag names without the display # prefix. */
export function normalizeFoodLogTags(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  const seen = new Set<string>();
  return parts.flatMap((part) => {
    if (typeof part !== 'string') return [];
    const tag = part.trim().replace(/^#/, '');
    if (!/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag) || !/[\p{L}_/-]/u.test(tag)) return [];
    const key = tag.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [tag];
  });
}
