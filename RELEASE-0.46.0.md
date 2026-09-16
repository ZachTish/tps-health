# TPS Health 0.46.0

Adds supplement and micronutrient tracking to the existing food logger, with 37 optional fields and fixes for dose-entry stability. This is a backward-compatible feature release (minor version).

- Save creatine, pre-workout, and multivitamin label amounts as ordinary custom foods. Use capsules, tablets, scoops, grams, or servings; partial doses scale the nutrients correctly.
- Expand **Vitamins, minerals & supplements** in the food editor and search for a nutrient. Unknown amounts stay absent; explicit zero is preserved. No separate supplement tab or automatic dose targets.
- Recorded nutrients survive saves, edits, recipes, the persistent tray, atomic notes/lines, and daily totals. Inline Macros shows compact nutrient contribution rows; Macros Bases respect visible properties. Atomic nutrient property names remain configurable.
- Convert USDA mass units and Open Food Facts normalized gram values without rounding tiny vitamin amounts to zero. Supplements with reported nutrients are no longer filtered out solely for having no macros.
- Typed tray quantities save immediately without replacing the input. Small doses no longer jump to the plus/minus step on blur. Fix narrow nutrient editor overflow and reject invalid negative amounts before saving.
- Clearing a nutrient removes stale values from definitions, linked logs, and configured atomic-line rollups. Existing settings/routes/actions and normal food workflows remain available.

## Validation and handoff

375 automated tests passed; no failures. One optional live USDA integration test was skipped because no test API key is configured; provider behavior and conversions were verified with deterministic fixtures. Full declared suite, TypeScript check, separate final production build, shared test-vault deployment, plugin reload, and byte-for-byte artifact comparison completed.

Actual test-vault UI: Search → Create food → log one capsule from a two-capsule label; exact log and daily nutrient totals; edit/removal propagated to the linked log; negative-input validation; nutrient search; mobile emulation at 390 px without horizontal overflow; quantity 0.125 retained after X/reopen; backdrop dismissal kept the logger open; settings routes and the nutrient-property selector verified. Synthetic notes were archived and original settings/tray restored.

Minimum Obsidian: **1.12.0**. Tested in **Obsidian Plugin Test Vault**, ready for the user's BRAT pull. Not installed in production; physical iPhone/iPad keyboard/camera testing remains with the user.

## Limits

This adds 37 fields, not Cronometer's complete food database or 82-nutrient parity. Nutrient availability depends on the source. Existing saved foods need a deliberate edit or reimport to add previously discarded nutrients. Extended supplement label fields can be entered manually; AI label OCR/estimates are not guaranteed to populate them. Enter absolute mass amounts, not percent Daily Value or IU; ambiguous vitamin forms and unknown capsule weights are not guessed. No dosing advice or default supplement targets are provided.

## SHA-256

```
e3ed41e6a60449b7717ce12e03bee7aec44c1650372cd6c388c8651cadfe97e3  main.js
e31f4dbbdda237078964a5aa6c8d2673a4c28e091f15dd394d1e891712c658bf  manifest.json
ff2d6bec18e9896c3d5f82a07a33d26500b0844b0fa79bc83478945cc306817a  styles.css
```
