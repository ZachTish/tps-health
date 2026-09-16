# TPS Health

Food, recipes, nutrition dashboards, activity, and workout logging for Obsidian.

Current release: [0.45.3](https://github.com/ZachTish/tps-health/releases/tag/0.45.3) · Obsidian 1.12.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/tps-health` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Log food and workouts

**Log food** searches saved foods and databases together; scanning sits beside search, with Describe and quick-add routes available. The persistent tray keeps unlogged items, and the logger closes through its explicit close button. Categorize food logs with tags instead of a section selector.

Macros can be shown in inline blocks or a dedicated **Macros Base** with native date-range filters. Appearance options include rings for main macros and compact nutrient rows. Meals/recipes and nutrient totals expand into contributing components.

**Start workout** or **Start blank workout** opens the workout flow. Set deletion and separate dropset boundaries are supported. Workout controls appear for an open active workout; rendered content belongs in Live Preview and Reading mode, while Source mode stays literal. Atomic note workouts have their own notes. Atomic line workouts retain a real level-2 heading in the Daily Note for their legacy inline blocks.

## Barcode Flow

The scanner overlays flash, camera-switch, and image-import icons on the camera viewport. Flash is disabled when the camera cannot provide a torch. It no longer shows an Apple Shortcut button. Legacy Shortcut inbox compatibility remains for existing setups.

On iOS, Apple's true VisionKit scanner is native app code; the plugin probes for known native barcode bridge shapes. When no bridge exists, is cancelled, or errors, the web-camera path remains available. Portrait locking is requested while scanning and released on exit; platform support and physical camera/torch behavior require device testing.

USDA credentials use device-local Obsidian SecretStorage. The `DEMO_KEY` fallback is rate-limited; routine tests use synthetic responses rather than spending public quota. A live USDA test requires the optional `USDA_FDC_TEST_API_KEY` test credential. Barcode coverage and serving-size quality still depend on the returned food data; review the selected serving before logging.

## Settings

The hub opens on **Daily logging**; the other routes are **Food & goals**, **Workouts**, **Note library**, and **Integrations & advanced**. Exercise tag and library identification remain configurable. Custom goal JSON and Provider credentials are optional disclosures. Rerenders retain route and scroll position. Food-log tags categorize records; they are not yet per-tag calorie-goal enforcement.

The reference's old `Default food log section` and Apple Shortcut instructions describe legacy compatibility, not controls in the current logger. Native/legacy record migrations remain explicit; changing display preferences does not silently convert records.

## Atomic line compatibility and API

Health no longer registers the retired `tps-health-food-log` Base view. GCM's generic `tps-table` remains available for legacy log tables: `lineFilterKey: food`, `totalsRow: top`, and `createCommandId: tps-health:log-food`. GCM TPS Table scans matching Markdown inline-property lines. The dedicated Macros Base is a separate nutrition summary surface.

The enabled plugin exposes `app.tpsHealth`/`api` for food lookup, exact-food logging, activities, workout plans, and sessions. Prefer a barcode or exact food-note path for deterministic logging. See [the detailed reference](REFERENCE.md) and [src/main.ts](src/main.ts) for API and record contracts; the reference preserves release-specific validation and retired workflows as history.

## Development and repository policy

`main` is the stable source line. Numeric tags identify immutable released artifacts. `optimization` is an unreleased work-in-progress lane; do not install it through BRAT or merge it into stable without separate validation.

The supported build lives inside `Obsidian Plugin Test Vault/Plugin Development`, with `TPS-health (Dev)` as the mapped stable source. These repositories depend on adjacent shared tooling including `deploy-runtime.mjs`; a standalone clone is not currently self-contained.

From the contained workspace, prepare dependencies using the shared helper, then run tests and a separate final build:

```sh
# From Plugin Development:
node ./prepare-dependencies.mjs "TPS-health (Dev)"
cd "TPS-health (Dev)"
npm test
npm run build
```

Dependencies stay in the vault's `.plugin-dev-cache.nosync` through a relative `node_modules` symlink. Use a clean, current checkout; preserve unrelated changes and never build an old dirty worktree into the test runtime. Stable builds deploy only shipped artifacts to the test vault. Optimization builds are build-only. Runtime `data.json`, secrets, caches, and session state never belong in Git.

Documentation-only maintenance does not create a new plugin version. Published release tags and assets are preserved. Do not rely on legacy version/release scripts without reviewing their current behavior. Production updates remain the user's BRAT handoff.

For prior feature details and release-specific evidence, see [REFERENCE.md](REFERENCE.md) and [GitHub releases](https://github.com/ZachTish/tps-health/releases). The September 16 cleanup changes documentation and repository metadata, not shipped behavior.


## 0.46.0 — Supplement nutrients and serving stability

Supplements use the existing food logger: search saved foods/databases or create a custom food from its label, then log capsules, tablets, scoops, grams, or servings. A label for two capsules is entered as serving amount **2**, unit **capsule**; logging one capsule records half its nutrients. No gram weight is invented for a count-based dose. Saved items remain ordinary reusable food notes; no new entity kind, folder, tab, or supplement recommendation is imposed.

The custom food editor adds one **Vitamins, minerals & supplements** disclosure with a search field. It stores absolute amounts per labeled serving (g, mg, or mcg), preserves explicit zero, and omits unknown amounts. Enter absolute label amounts, not percent Daily Value or IU. Vitamin A uses RAE, folate uses DFE, and vitamin E uses alpha-tocopherol; differing forms are not silently converted. Proprietary blends without individual amounts remain unknown. AI estimates/label OCR still require manual review and entry for these extended fields.

Coverage: vitamins A, C, D, E, K, B1, B2, B3, B5, B6, biotin, folate, B12, and choline; calcium, iron, magnesium, phosphorus, potassium, zinc, copper, manganese, selenium, iodine, chromium, molybdenum, chloride (plus existing sodium); creatine, caffeine, beta-alanine, L-citrulline, taurine, betaine, L-carnitine, L-theanine, omega-3, and cholesterol. This is 37 additional fields, not a claim of complete Cronometer database or 82-nutrient parity. No nutrient values are inferred merely from a product name.

Extended amounts survive custom-template creation, editing, persistent trays, recipe scaling, atomic note projections, atomic line snapshots, and daily aggregation. Inline Macros automatically shows recorded values in its existing nutrient rows with contribution expansion and no implicit targets. Macros Bases use native property visibility/order to select nutrient rows. Optional goals use the canonical nutrient keys in [src/nutrients.ts](src/nutrients.ts). The GCM property catalog exposes extended fields only when a corresponding goal is configured, avoiding dozens of empty default controls.

The existing settings hub/default route and every prior action remain unchanged. Within **Integrations & advanced → Health record frontmatter**, a nutrient selector edits one property name at a time using the existing `nativeRecordProperties`/alias contract. Selector, search, and disclosure state are transient. Core macros keep their existing defaults; new nutrient amounts are optional and absent from old records. Custom food definitions use canonical nutrient keys; configurable property names apply to atomic log records.

Food review now persists valid quantity edits on input while retaining the focused control and scroll position. Typed amounts no longer snap to the plus/minus step on blur (for example 3 g becoming 10 g); fractional doses keep six decimal places. The existing explicit-X dismissal, tray recovery, request ordering, and duplicate-submit guards remain in place.

Provider conversion follows [USDA nutrient units](https://fdc.nal.usda.gov/portal-data/external/dataDictionary) and [Open Food Facts normalized nutrient mass units](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/). OFF vitamins/minerals are converted from grams before rounding; USDA amounts require matching nutrient identity and a mass unit. Ambiguous vitamin forms, missing units, and unknown serving weights are not guessed. Barcode coverage depends on the provider; existing saved foods need a deliberate edit/reimport to gain previously discarded nutrients. Workflow inspiration: [Cronometer supplement logging](https://support.cronometer.com/hc/en-us/articles/360000328566-How-do-I-add-a-supplement-to-my-diary) and [custom label foods](https://support.cronometer.com/hc/en-us/articles/360018240312-Create-a-Custom-Food).

Validation includes supplement save/reload/edit/removal, custom templates, small-dose atomic lines, capsule scaling, projection persistence, unknown-versus-zero, provider unit conversion, nutrient contributions, Base visibility, and quantity input/blur stability. Minimum Obsidian remains 1.12.0. Physical iPhone keyboard/camera behavior still needs user device testing; desktop narrow-layout QA does not substitute for an iOS run.


Test-vault UI verification (2026-09-16): Obsidian 1.14.2 app package, desktop and mobile emulation with a 390 px editor. Created a synthetic two-capsule supplement via Search → Create food, logged one capsule through the Log button, and verified B12 1.2 mcg, magnesium 50 mg, creatine 2.5 g, and caffeine 100 mg in the atomic log and Macros contribution rows. Clearing vitamin D with “Update linked instances” removed it from the definition and log. Negative label amounts kept the editor open and focused the invalid field. Nutrient search retained entered values; measured disclosure/row scroll width equaled client width after fixing inherited setting-control widths. X/reopen retained a typed 0.125 dose; backdrop click only dismissed focus. All five settings routes rendered, and the nutrient-property selector exposed 37 options and the selected field. Synthetic files were archived under `_archive/Health Supplements QA 0460`; original test settings and pending tray were restored. Reload uses `plugin:reload id=tps-health` in the test vault; final build deploys only shipped artifacts through the shared helper. No production installation or physical iPhone QA is claimed.
