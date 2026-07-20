import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/food-log-entry-snapshot.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { resolveFoodLogEntrySnapshot } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const rowA = "- 1 serving [[Egg]] <!-- [food:: Egg] [qty:: 1] [foodId:: food-a] -->";
const rowAChanged = "- 2 servings [[Egg]] <!-- [food:: Egg] [qty:: 2] [foodId:: food-a] -->";
const rowB = "- 1 serving [[Toast]] <!-- [food:: Toast] [qty:: 1] [foodId:: food-b] -->";
const legacyRow = "- 1 serving [[Milk]] [food:: Milk] [servings:: 1]";

test("food row snapshot prefers the exact zero-based line and raw Markdown", () => {
  assert.deepEqual(resolveFoodLogEntrySnapshot(["# Log", rowA, rowB], 1, rowA), {
    status: "matched",
    lineNumber: 1,
    line: rowA,
  });
});

test("food row snapshot relocates only a unique foodId before exact raw fallback", () => {
  assert.deepEqual(resolveFoodLogEntrySnapshot([rowB, rowAChanged], 0, rowA), {
    status: "matched",
    lineNumber: 1,
    line: rowAChanged,
  });

  const duplicateIdButUniqueRaw = [rowAChanged, rowA, rowB];
  assert.deepEqual(resolveFoodLogEntrySnapshot(duplicateIdButUniqueRaw, 2, rowA), {
    status: "matched",
    lineNumber: 1,
    line: rowA,
  });
});

test("identity-less rows relocate only when the exact raw line is unique", () => {
  assert.deepEqual(resolveFoodLogEntrySnapshot([rowB, legacyRow], 0, legacyRow), {
    status: "matched",
    lineNumber: 1,
    line: legacyRow,
  });
  assert.deepEqual(resolveFoodLogEntrySnapshot([legacyRow, rowB, legacyRow], 1, legacyRow), {
    status: "stale-line",
  });
});

test("ambiguous, removed, and empty addressed rows fail closed", () => {
  assert.deepEqual(resolveFoodLogEntrySnapshot([rowA, rowA], 4, rowA), { status: "stale-line" });
  assert.deepEqual(resolveFoodLogEntrySnapshot([rowB], 0, rowA), { status: "stale-line" });
  assert.deepEqual(resolveFoodLogEntrySnapshot(["", rowB], 0, rowA), { status: "stale-line" });
});

test("a non-food supplied snapshot is no-match even if arbitrary text exists", () => {
  assert.deepEqual(resolveFoodLogEntrySnapshot(["ordinary text"], 0, "ordinary text"), {
    status: "no-match",
  });
});
