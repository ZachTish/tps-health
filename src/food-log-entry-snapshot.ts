export type FoodLogEntrySnapshotResolution =
  | { readonly status: "matched"; readonly lineNumber: number; readonly line: string }
  | { readonly status: "stale-line" | "no-match" };

export function isFoodLogSnapshotLine(line: string): boolean {
  return line.includes("tps-health:food")
    || (/\[food::\s*[^\]]+\]/i.test(line) && /\[(qty|servings)::\s*-?\d/i.test(line));
}

function readFoodId(line: string): string | undefined {
  const match = line.match(/\[foodId::\s*([^\]]+)\]/i);
  return match ? match[1].trim() : undefined;
}

export function resolveFoodLogEntrySnapshot(
  lines: readonly string[],
  lineNumber: number,
  rawLine: string,
): FoodLogEntrySnapshotResolution {
  if (!isFoodLogSnapshotLine(rawLine)) return { status: "no-match" };
  if (Number.isSafeInteger(lineNumber)
    && lineNumber >= 0
    && lineNumber < lines.length
    && lines[lineNumber] === rawLine) {
    return { status: "matched", lineNumber, line: rawLine };
  }

  const foodId = readFoodId(rawLine);
  if (foodId) {
    let matchedIndex = -1;
    let matches = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const currentLine = lines[index];
      if (!isFoodLogSnapshotLine(currentLine) || readFoodId(currentLine) !== foodId) continue;
      matchedIndex = index;
      matches += 1;
      if (matches > 1) break;
    }
    if (matches === 1) return { status: "matched", lineNumber: matchedIndex, line: lines[matchedIndex] };
  }

  let exactIndex = -1;
  let exactMatches = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== rawLine || !isFoodLogSnapshotLine(lines[index])) continue;
    exactIndex = index;
    exactMatches += 1;
    if (exactMatches > 1) break;
  }
  return exactMatches === 1
    ? { status: "matched", lineNumber: exactIndex, line: lines[exactIndex] }
    : { status: "stale-line" };
}
