# TPS Health 0.47.0

Food search now prioritizes matching saved notes and makes the limits of nutrition data visible. This backward-compatible minor release follows an audit of all search sources and the 42 built-in foods, informed by Cronometer, MacroFactor, MyFitnessPal and official provider documentation. [Full audit and inventory](https://github.com/ZachTish/tps-health/blob/0.47.0/FOOD-DATA-AUDIT.md).

- Matching local food notes appear ahead of database and built-in results. Barcode lookup, search deduplication and note reuse preserve saved serving/nutrition; deliberate editor and duplicate-review updates remain available.
- Unknown nutrients stay unknown through import/templates/save/reload. Explicit zero-calorie foods and partial labels remain searchable. Malformed values, incompatible units and conversion overflow do not become valid nutrient amounts.
- Results expose calorie/macro coverage and one accessible **Nutrition data details** disclosure with source, dataset, record ID, dates and review warnings. Completeness does not certify accuracy.
- Corrected OFF kJ, salt/sodium, alcohol ABV, total-carbohydrate precedence and polyol handling, plus USDA core-unit conversion. Ingredient mentions no longer manufacture polyol totals. Imported reported energy stays intact.
- All 42 built-in entries lack recorded source evidence. They are clearly labeled unverified estimates, receive lower ranking, and cannot overwrite identified database records. Their numeric values were not replaced with unsupported guesses.

Optional `nutritionProvenance` is additive food metadata and an optional create/upsert API field. It records an import, not a certification of later manual edits. Existing settings, commands, navigation and defaults are preserved; no startup migration or historical note rewrite runs. Minimum Obsidian: **1.12.0**.

## Validation

**419 tests passed, 0 failed, 1 skipped** (optional live USDA test without a configured test key). Seventeen focused data-quality tests cover local ordering/preservation, source identity, numeric boundaries, zero/unknown values, units, coverage, provenance, and energy preservation. The complete declared suite, TypeScript and mandatory separate final production build passed; the shared helper deployed only shipped artifacts to the test vault. Test-runtime hashes match all release artifacts.

Reloaded **Obsidian Plugin Test Vault** checks verified desktop and 390 px mobile-emulation search, two saved matches above an exact database match, zero-calorie visibility, dated source receipts, incomplete/impossible-data warnings, keyboard disclosure toggles/focus, and no horizontal overflow or accidental Add. UI provider responses were synthetic; the suite separately exercised public Open Food Facts. Synthetic notes were archived, provider methods/pending tray restored, and desktop mode restored. Health's `data.json` stayed byte-identical. Final plugin reload and version checks passed.

Known limits: provider labels may still be wrong or incomplete; the unsourced built-in catalogue is not independently verified. TPS tracks 46 nutrients and does not reproduce competitors' licensed data or human-review operations. Missing serving/volume evidence and ambiguous nutrient forms cannot be safely guessed. Existing historical zeroes cannot be repaired automatically. Daily totals still sum known values; these search indicators do not certify historical totals. Physical iPhone behavior and live USDA data were not verified.

Committed and published from a clean contained worktree based on released main, preserving the older dirty canonical checkout. Tested in the test vault and ready for the user's **BRAT pull of 0.47.0**. Production was not inspected or deployed to.

## SHA-256

```text
1db5bf6b25418d4514b4886a075029871c4e49417aa54e3ad6481cf967959d4f  main.js
e182821888be6a16e65fd56b2c836cc187db6455cc9ccc4250e3d176ef771ea5  manifest.json
3a69e4bdfb0a7629247fe7294ac36c1d23e93d339377e3267df633b0128555d5  styles.css
```
