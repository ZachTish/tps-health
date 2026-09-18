# TPS Health 0.47.1

Macros blocks and Macros Base summaries now display nutrient values with at most one decimal place: `123.456 kcal` becomes `123.5 kcal`, and `12.345 g` becomes `12.3 g`. Whole numbers remain compact.

The change covers calorie headers, ring/table values, goal labels, accessible ring labels, nutrient contributions, food summaries and recipe-component nutrient pills. Stored nutrition, calculation precision, goal comparisons, progress and serving quantities are unchanged. Other activity/workout and food-editor formatting is unchanged. Very small nutrients may display as zero after rounding; their stored amounts remain available in the underlying records. No settings, commands, defaults or schema migration.

This is a backward-compatible display-fix patch. Minimum Obsidian: **1.12.0**.

Validation: **421 passed, 0 failed, 1 skipped** (optional live USDA test without a test key). Full declared suite, TypeScript and separate final production-mode build passed. Test-vault deployment and `plugin:reload id=tps-health` completed. A temporary in-memory preview in the reloaded test vault verified table/ring/contribution/food-summary values, goal rounding and accessible labels using the real shared macros renderer. Protein remained 12.345 internally and a 0.025 serving stayed exact. The preview was removed; no notes were created and Health's settings file remained byte-identical. Physical-device testing was not needed for this formatting-only change and is not claimed.

Tested in **Obsidian Plugin Test Vault**, with the exact artifacts below ready for the user's **BRAT pull of 0.47.1**. Production was not accessed or deployed to.

## SHA-256

```text
bb96ac4b0f51baba23de2b36fcfc9f170ca1a6ce29f42f60d762cc4cf2148047  main.js
c8e681ac03a71ee1d86111f8bb2ec994d1b3e0911f8f9c598142de080ea95acb  manifest.json
3a69e4bdfb0a7629247fe7294ac36c1d23e93d339377e3267df633b0128555d5  styles.css
```
