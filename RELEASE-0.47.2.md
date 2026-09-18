# TPS Health 0.47.2

Search now retrieves current Open Food Facts product records before showing nutrition and servings. Previously, index summaries could omit the 355 ml White Claw serving and contain older nutrient values, leaving users with a 100 g result until after selection.

- One bounded bulk request retrieves up to 40 discovered products, including products whose search summaries omit macros. Missing/full-record failures never resurrect index nutrition. Query coalescing, cached results, shared rate limits and exact-product selection reuse keep requests bounded.
- Closely matching complete labeled servings rank above incomplete results; records with no core calorie/macronutrient data rank lower. Saved matching food notes retain priority. Textual relevance is preserved so separated query words in an unrelated food do not receive the completeness preference.
- Explicit 355 ml label equivalents retain 355 ml instead of a rounded fluid-ounce conversion. Other package sizes retain their own servings. Explicit volume evidence supports a 100 ml fallback without assuming package quantity is one serving or grams equal ml.
- **Nutrition data details** contains the base serving and a simple list of all nine core nutrient amounts plus reported extras. Missing values display “—”, measured zeroes stay zero, and positive amounts smaller than the rounding threshold display “<0.1”. Audit explanations are removed from the disclosure; import receipts and compact review indicators remain.

This backward-compatible patch changes no settings keys, commands, stored precision or schema. Minimum Obsidian: **1.12.0**.

## Validation

- Full declared suite: **427 passed, zero failed, one skipped** (optional live USDA test requires a test credential).
- TypeScript and the mandatory separate `npm run build` passed. Shared runtime deployment reported `target=test`; the final rebuild was byte-identical.
- Reloaded only TPS Health in **Obsidian Plugin Test Vault**. Live public OFF search displayed the Black Cherry product's 355 ml serving, 100 kcal and 2 g carbohydrate. Its selector offered serving (355 ml), cup, ml and fl oz, without weight-ounce/gram choices.
- The expanded nutrient list showed all core fields without explanatory paragraphs, took focus without adding food, and had no horizontal overflow at 388 px modal width. Captured source fixtures also cover 355 ml Zero Proof and 568 ml cans, batch identity isolation, stale values, missing products, rate limits and cache reuse.
- Temporary QA overrides/modals were removed. Existing notes and runtime settings were preserved; `data.json` remained byte-identical. USDA was stubbed offline for UI QA; no AI requests or consumption writes were made.

## Data limitations

Current product records are not independently certified. The live audit found erroneous gram-based beverage servings, brand tags, nutrient transcription and a Black Cherry ABV inconsistent with the manufacturer's 5% label. Reported data is preserved and marked for review; this release does not invent density conversions, a brand-wide 355 ml serving, or alcohol corrections. Package-label-checked saved foods remain the preferred source. See [the audit](https://github.com/ZachTish/tps-health/blob/0.47.2/FOOD-DATA-AUDIT.md). Physical iPhone behavior and live USDA data were not verified.

**Tested in the test vault and ready for the user's BRAT pull. Production has not been inspected, deployed or reloaded.**

## Artifact SHA-256

```text
main.js       0e3da0e243df87866792f2adf02ff80fcc48738add0976cb62d8ad55c4f669fd
manifest.json 5dfe5aa044a3ba1e53179da2d2841da90a0c33b2e41267b1ba4a3c6c9ecc8395
styles.css    3a69e4bdfb0a7629247fe7294ac36c1d23e93d339377e3267df633b0128555d5
```
