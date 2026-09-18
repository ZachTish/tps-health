# TPS Health

Food, recipes, nutrition dashboards, activity, and workout logging for Obsidian.

Current release: [0.48.0](https://github.com/ZachTish/tps-health/releases/tag/0.48.0) · Obsidian 1.12.0+ · Desktop and mobile.

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

Extended amounts survive custom-template creation, editing, persistent trays, recipe scaling, atomic note projections, atomic line snapshots, and daily aggregation. Inline Macros automatically shows recorded values in its existing nutrient rows with contribution expansion and no implicit targets. Macros Bases retain native property order and, from 0.47.4, also show recorded nutrients automatically; choose **Show nutrients → Selected properties only** in view options to restrict rows to visible properties. Optional goals use the canonical nutrient keys in [src/nutrients.ts](src/nutrients.ts). The GCM property catalog exposes extended fields only when a corresponding goal is configured, avoiding dozens of empty default controls.

The existing settings hub/default route and every prior action remain unchanged. Within **Integrations & advanced → Health record frontmatter**, a nutrient selector edits one property name at a time using the existing `nativeRecordProperties`/alias contract. Selector, search, and disclosure state are transient. Core macros keep their existing defaults; new nutrient amounts are optional and absent from old records. Custom food definitions use canonical nutrient keys; configurable property names apply to atomic log records.

Food review now persists valid quantity edits on input while retaining the focused control and scroll position. Typed amounts no longer snap to the plus/minus step on blur (for example 3 g becoming 10 g); fractional doses keep six decimal places. The existing explicit-X dismissal, tray recovery, request ordering, and duplicate-submit guards remain in place.

Provider conversion follows [USDA nutrient units](https://fdc.nal.usda.gov/portal-data/external/dataDictionary) and [Open Food Facts normalized nutrient mass units](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/). OFF vitamins/minerals are converted from grams before rounding; USDA amounts require matching nutrient identity and a mass unit. Ambiguous vitamin forms, missing units, and unknown serving weights are not guessed. Barcode coverage depends on the provider; existing saved foods need a deliberate edit/reimport to gain previously discarded nutrients. Workflow inspiration: [Cronometer supplement logging](https://support.cronometer.com/hc/en-us/articles/360000328566-How-do-I-add-a-supplement-to-my-diary) and [custom label foods](https://support.cronometer.com/hc/en-us/articles/360018240312-Create-a-Custom-Food).

Validation includes supplement save/reload/edit/removal, custom templates, small-dose atomic lines, capsule scaling, projection persistence, unknown-versus-zero, provider unit conversion, nutrient contributions, Base visibility, and quantity input/blur stability. Minimum Obsidian remains 1.12.0. Physical iPhone keyboard/camera behavior still needs user device testing; desktop narrow-layout QA does not substitute for an iOS run.


Test-vault UI verification (2026-09-16): Obsidian 1.14.2 app package, desktop and mobile emulation with a 390 px editor. Created a synthetic two-capsule supplement via Search → Create food, logged one capsule through the Log button, and verified B12 1.2 mcg, magnesium 50 mg, creatine 2.5 g, and caffeine 100 mg in the atomic log and Macros contribution rows. Clearing vitamin D with “Update linked instances” removed it from the definition and log. Negative label amounts kept the editor open and focused the invalid field. Nutrient search retained entered values; measured disclosure/row scroll width equaled client width after fixing inherited setting-control widths. X/reopen retained a typed 0.125 dose; backdrop click only dismissed focus. All five settings routes rendered, and the nutrient-property selector exposed 37 options and the selected field. Synthetic files were archived under `_archive/Health Supplements QA 0460`; original test settings and pending tray were restored. Reload uses `plugin:reload id=tps-health` in the test vault; final build deploys only shipped artifacts through the shared helper. No production installation or physical iPhone QA is claimed.


## 0.46.1 — Keep food servings aligned with note edits

An explicit `servingAmount` with `servingUnit` g/grams or ml/milliliters is the nutrition denominator, taking precedence over stale imported `servingGrams`, `servingMl`, and incompatible `nutritionBasis` values. Changing 100 g to 355 g makes the logger display **serving (355 g)** and makes 177.5 g half a serving. Nutrition values stay exactly as entered; this repair does not guess product facts or rescale the authored label. Coherent per-100 foods retain their existing labels and defaults. Household servings retain their explicit metric mappings; no density or capsule weight is inferred by this reconciliation.

The same denominator drives atomic note projections. Saving an edited food clears obsolete metric/basis fields instead of leaving them in frontmatter. Persistent tray refresh detects basis-only changes without changing the user's selected quantity. Ordinary reads normalize in memory; they do not bulk rewrite food definitions or historical atomic-line snapshots. Settings, commands, layouts, and minimum Obsidian 1.12.0 are unchanged.

Regression coverage reproduces stale per-100 metadata, gram/milliliter switching, half-serving calculations, unsupported cross-unit conversions, count-based edits, returned and persisted food data, atomic projections, and tray refresh. The optional live Open Food Facts check now has a 15-second timeout so an unavailable provider cannot hang the suite.

Validation: 379 automated tests passed, with one optional live USDA check skipped for lack of a test key; full suite and TypeScript build passed. In the reloaded test vault, a synthetic 355 g note with stale 100 g metadata reproduced the old dropdown and then displayed **serving (355 g)** after the fix. Entering 177.5 g showed half the calories/carbs (23.3 kcal / 0.3 g at UI precision). The food editor showed the same 355 g serving; saving 355 ml through **Update linked instances** removed `servingGrams` and persisted `servingMl: 355` with a labeled basis. Original tray state was restored and the fixture archived under `_archive/Health Serving QA 0461`. Reload uses `plugin:reload id=tps-health`; the separate final production-mode build deploys only shipped artifacts through the shared test-vault helper. No physical mobile or production installation is claimed.


## 0.46.2 — Reject incompatible food quantities

Refreshing or editing a queued food keeps the entered quantity **and unit**. If a definition changes from grams to milliliters, the tray no longer silently interprets 177.5 g as 177.5 servings. The original unit remains visible with a concise correction message; logging is blocked until the user selects a supported unit. Valid selections retain their existing behavior. One shared row renderer keeps input, blur, and full-refresh messages/calculations consistent without replacing the focused controls.

The logging API rejects unsupported units, zero, negative, and nonfinite quantities before creating a consumption record. Batch preflight retains an invalid tray without writing any of its entries; recipe ingredient creation also rejects unsupported conversions. The API still revalidates against the resolved food definition, covering edits between tray refresh and submission. No unit density or replacement quantity is guessed. Existing notes/logs are not bulk migrated. Settings, commands, minimum Obsidian 1.12.0, and valid atomic note/line contracts remain unchanged.

Cleanup review: the retired TPS Home action compatibility API and Apple Shortcut scanner compatibility path are candidates for a separately announced removal; legacy atomic-line writers require a migration/export plan before retirement. These are flagged, not removed by this patch. Keep the requested Macros Base, provider fallbacks, migrations, and shared identity APIs until their consumers and compatibility requirements are explicitly resolved.

Labeled household portions now take precedence over generic volume conversions: a food defined as one cup weighing 170 g logs half a cup as 85 g, rather than becoming an unsupported 120 ml conversion. This agrees with the atomic note projection path. Removed the unreachable Apple Shortcut launcher, URL builder, and visibility predicate left behind when its button was retired; existing Shortcut inbox compatibility remains pending a separate removal decision.

Validation: 383 automated tests passed, zero failed; one optional live USDA test was skipped because no test key is configured. The full declared suite and TypeScript/build passed. In the reloaded Obsidian Plugin Test Vault, an old 177.5 g tray against a newly ml-based definition retained g, displayed the correction message, and wrote nothing on Log. Selecting ml showed 50 kcal / 12.5 g carbs and the Log button created an atomic entry with those exact values. The synthetic entry was archived, original pending tray/root settings restored, and fixtures moved to `_archive/Health Audit 0462`. Final deployment uses the shared helper and reload uses `plugin:reload id=tps-health`. No physical mobile or production mutation is claimed.


## 0.46.3 — Search and Describe tray reliability

The main food logger shows saved matches immediately and searches configured food databases after an 800 ms typing pause. Enter or the search icon still searches immediately; typed barcode numbers require explicit submission so a partial barcode cannot add a food. Query changes, tab switches, and closing invalidate earlier work. Provider caches, branded-food preferences, rate-limit handling, and bounded timeouts remain in place. Recipe ingredient/editor suggestions retain their local-first behavior. Exact product names receive stronger ranking than broad curated variants.

Describe appends its completed estimates to the existing persistent tray, preserving quantities and consumed time, then opens review in the same modal. It no longer replaces earlier selections or hides completion behind a newly opened collapsed tray. Prepared-workflow retries with the same draft ID do not append twice. Closing during preparation retains the existing completion notice with an **Open tray** action that opens review expanded. Failures retain the description and allow retry. Common written quantities (one through twelve) are parsed as amounts, including separate foods joined by “and”. AI estimates still require portion/nutrition review; provider availability and accuracy are not guaranteed.

Phone layout removes inherited search-field padding, keeps secondary research/create actions at the end of the scrolling results instead of squeezing the list with a fixed panel, and puts method tabs before Describe/Quick add forms. Mobile controls use 16 px input text to avoid focus zoom, and consumed-time controls can wrap. Search/Describe, Scan, Quick add, Create food/meal, research, review, tags, consumed time, and explicit-X dismissal remain available. The five settings destinations and persisted settings schema are unchanged. Minimum Obsidian remains 1.12.0.

Regression coverage exercises settled search, stale/closed queries, explicit barcode submission, exact product ranking, spoken quantities, Describe completion in place, retention of existing foods/time, prepared retries, and failure recovery. Live public Open Food Facts lookup returned Michelob Ultra results; AI UI testing uses a deterministic fixture, not private provider credentials. Physical iPhone keyboard behavior requires device testing. Stable builds deploy only shipped files to the test vault; reload uses `plugin:reload id=tps-health`. Production installation remains the user's BRAT pull.


0.46.3 test-vault UI verification: mobile emulation at 390 px showed seven combined Michelob Ultra results without Enter, with exact products above the curated seltzer variant. Describe with a deterministic gateway fixture immediately expanded review, retained the existing two-unit food, and added one estimated banana with its serving/nutrition. Search actions scroll after results; method tabs remain above the Describe form. Narrow-layout review exposed theme padding squeezing remove/close icons to 4 px; their glyphs now retain 20 px within 44 px controls. The review hides the underlying results while expanded. At the narrowest phone widths, the serving selector gets its own full-width row so its label is readable. No food log was written during this UI check. Physical iOS and live AI-provider execution are not claimed.


## 0.46.4 — Keep Describe and the visible tray synchronized

Verification of 0.46.3 exposed races when Describe completed after closing/reopening the logger, or while an existing food was being logged. Open loggers now adopt completed estimates immediately, expand review, and preserve unchanged entry identities so a successful log removes its original tray entry. A logger with an unrelated stale tray stops and displays the current tray before submitting more foods. Failure to save the initial tray prevents any log writes.

A failed tray save no longer invokes food-matching fallback or creates duplicate estimates. Prepared estimates remain available for retry, including the no-Gateway local matching path. A later successful save, quantity edit, removal, clear, or log claim acknowledges the prepared workflow so already handled estimates cannot reappear at startup. These guards cover the tested interleavings; they do not make note writes and settings saves one atomic filesystem transaction. Search behavior, settings destinations/schema, commands, notes, and minimum Obsidian 1.12.0 remain unchanged.

Regression coverage adds reopened loggers, stale ownership, Describe completing during batch logging, interrupted persistence/retry, edits after failed saves, and log/remove/clear followed by workflow resume. Generic-serving Describe estimates now define one serving consistently: two eggs show two 50 g servings and retain the same total nutrition. Explicit gram/milliliter quantities keep their existing basis. Existing notes and previously queued estimates are not rewritten. Full validation and UI results are recorded below. The release is a backward-compatible patch; production installation remains the user's BRAT pull.

Validation: 402 automated tests passed, zero failed, with one optional live USDA test skipped for lack of a test credential. The full declared suite and TypeScript build passed. In the reloaded 0.46.4 test vault, a deliberately delayed synthetic AI response completed after the logger was closed and reopened; the visible tray expanded with both existing and new foods. A portion edit survived another reopen, and an in-memory logging fixture consumed each item once and cleared both tray and pending workflow. No consumption notes were written in this check. Actual no-Gateway matching added “one banana and two eggs” to the existing tray at a measured 390 px modal width; Michelob Ultra returned seven combined results without Enter. The final serving fix displayed two egg servings of 50 g at 156 kcal, then 78 kcal after decreasing to one. Original pending tray state and desktop mode were restored.

The mandatory separate final production-mode build deploys only shipped artifacts through the shared test-vault helper; reload uses `plugin:reload id=tps-health`. Physical iPhone keyboard behavior and a live AI-provider request remain unverified. Public Open Food Facts was exercised, but database coverage/label correctness remain provider-dependent. No production installation is claimed.

## 0.47.0 — Food data quality and saved-first search

Matching saved food notes now appear before online and built-in results. Search, barcode lookup and reuse preserve their authored serving and nutrition; explicit editing remains available. Zero-calorie and partial records remain searchable, while missing/malformed nutrients remain unknown through import, templates and note reload.

Search results show calorie/macro coverage and one **Nutrition data details** disclosure with source/dataset, record ID, dates, total tracked-field coverage and review warnings. This is evidence and completeness, not a verified badge. Details use native keyboard behavior, visible focus and wrapping mobile text. Settings retain the same five destinations/default route and no persisted navigation state.

USDA core units and OFF kJ, salt, alcohol ABV and carbohydrate/polyol handling are corrected. Imported reported energy is preserved. All 42 built-in foods lack recorded source evidence: they remain available as unverified estimates, rank below comparable sourced records, and cannot overwrite them. No production notes or historical zeroes are rewritten. Optional `nutritionProvenance` is an additive import receipt, also accepted by food create/upsert APIs. Manual macro-only API calls retain their existing calculated-calorie behavior.

See [the complete data audit](FOOD-DATA-AUDIT.md) for the source inventory, competitor research, implementation decisions, coverage and limits. Reproduce the built-in inventory with `node scripts/audit-food-catalog.mjs`. Existing daily totals still sum known numeric values; search coverage does not certify historical daily totals. Provider coverage, unsupported nutrient forms, physical iPhone behavior and label correctness remain limitations.

Validation: 419 automated tests passed with zero failures; one optional live USDA test was skipped because no test key was configured. The full declared suite, TypeScript, separate final production-mode build and shared test-vault deployment passed. Reload used `plugin:reload id=tps-health`. Desktop and mobile emulation at a 390 px viewport verified two saved fixtures above an exact database match, a searchable zero-calorie fixture, source dates/coverage, provider and implausible-serving warnings, keyboard disclosure toggling and visible focus, with no horizontal overflow or accidental Add. QA used synthetic provider responses; the suite separately exercised public Open Food Facts. Physical iPhone behavior and live USDA data remain unverified.

Synthetic food notes were created in Inbox and moved directly to `_archive` after QA. Provider methods and the pending tray were restored; Health runtime `data.json` remained byte-identical through deployment/reload and QA. Desktop mode was restored. The dirty canonical stable checkout was preserved by working from released `origin/main` in a clean contained feature worktree. This backward-compatible minor release adds data-quality/provenance behavior without a settings migration. It is ready for the user's BRAT pull; no production installation is claimed.

## 0.47.1 — One decimal in the macros block

Macros blocks and Macros Base summaries display nutrient values and goal labels with at most one decimal place (12.345 → 12.3, 12.36 → 12.4). Whole numbers stay compact. This includes the calorie header, ring/table values, accessible ring labels, nutrient contributions, food summaries, and recipe-component nutrient pills. Stored nutrition, aggregation, comparisons, progress and serving quantities retain their existing precision; workout/activity and food-editor displays keep their previous formatting. Small nutrient amounts can display as 0 after rounding; the stored value remains available in the food note. No settings, commands or schema migration.

Focused model and rendered-block tests cover rounding, ring/table/contribution consistency and preservation of precise quantities and calculations. Full test/build and reloaded test-vault verification are recorded in the release notes. Minimum Obsidian remains 1.12.0; this is a backward-compatible display fix.

0.47.1 validation: 421 tests passed, zero failed, one optional live USDA test skipped without a test key. The declared suite and TypeScript build passed. The reloaded 0.47.1 test runtime rendered the real shared macros renderer with an in-memory fixture: 123.456 kcal became 123.5, protein 12.345 became 12.3 in table/ring/contribution/food-summary/accessibility text, and a 20.456 g goal became 20.5. The fixture's original protein 12.345 and serving quantity 0.025 remained intact. No notes or settings were changed; the temporary preview was removed. The mandatory separate final build deploys through the test-vault helper, followed by a plugin reload. Production handoff is the public BRAT release.

## 0.47.2 — Current product records and base-serving nutrition

Open Food Facts search now uses the text index only to discover matching product codes. Before returning results, one bounded bulk request (at most 40 codes) retrieves current product records, including labeled servings, the full as-sold nutrient set and provenance. Search-index nutrition is never used as a fallback when that request fails or a record disappears. The existing legacy search route can recover current records after non-rate-limit failures; a 429 opens the shared cooldown. Ten-minute query caching/coalescing remains, and the exact-product cache also reuses fetched records during selection. This adds one request to a successful uncached text search, without per-row request fan-out or changing the existing search timeout.

Among closely matching identities or matches sharing the whole query phrase, equally relevant, unused external matches with a metric label and all four calorie/protein/carbohydrate/fat fields precede incomplete matches. Saved matching notes still appear first and remain untouched. Explicit metric equivalents take precedence over converting ounces when normalized serving metadata is absent. A 12 fl oz (355 ml) label retains 355 ml; a 568 ml can retains 568 ml. When no serving is supplied, explicit volume evidence supports a 100 ml base rather than 100 g. Package quantity is never treated as a single serving, and grams are never relabeled as ml by guessing density.

**Nutrition data details** now contains only the base serving and a line for calories, protein, carbohydrates, fat, fiber, sugar, sugar alcohol, alcohol and sodium, followed by any reported extra nutrients. Missing values use “—”; measured zeroes remain zero. Display uses at most one decimal, with positive amounts below the rounding threshold shown as “<0.1”. Original values remain precise. Source receipts/flags remain in imported data and the compact result summary, without audit explanations in the disclosure. The native disclosure, keyboard focus and mobile wrapping are unchanged. No settings, commands or schema migration; minimum Obsidian remains 1.12.0.

The audit reproduced the original failure against live White Claw search and full-product responses: missing index servings, stale names/brands and conflicting index nutrition. Captured public fixtures cover 355 ml regular/zero-proof and 568 ml products, while tests also cover absent records, batch identity isolation, cache reuse, rate limits, missing volume, fractional grams and complete base-serving details. Full product records are more complete, not independently certified: upstream gram-based beverage entries, bad ABV values and incorrect label transcription remain possible. TPS preserves reported values and the review indicator rather than inventing brand-wide corrections. See [the audit follow-up](FOOD-DATA-AUDIT.md).

Validation results and reloaded test-vault UI checks are recorded in the release notes. This is a backward-compatible patch. Production installation remains the user's BRAT pull.

0.47.2 validation: 427 tests passed, zero failed; one optional live USDA test skipped without a test credential. The full declared suite and TypeScript build passed after the final ranking fix. Live public OFF search in the reloaded test vault displayed the 355 ml Black Cherry record with 100 kcal/2 g carbs; the serving selector offered serving (355 ml), cup, ml and fl oz, with no gram/weight-ounce option. The details disclosure rendered all nine core fields without audit prose, preserved unknown sugar alcohol, took focus without adding a food, and had no horizontal overflow at a measured 388 px modal width. Current-source ABV remains inconsistent with the manufacturer and is not certified by this test. The more complete result ranked above incomplete generic matches, and the unrelated lobster/shrimp word match no longer displaced it. QA used public OFF with USDA temporarily stubbed offline; no AI requests or food logs were made. Temporary overrides and modals were removed, original pending settings restored, and runtime data.json stayed byte-identical. The mandatory separate final build and named test-vault plugin reload complete the artifact validation; production is untouched.

## 0.47.3 — Make the food logging day obvious

The food search menu now keeps a date banner above Search/Describe/Quick add, outside the results scroller and visible while reviewing the tray. It shows a sun and **Logging today**, a moon and **Logging a past day**, or a calendar and **Logging a future day**, followed by the full weekday and calendar date including year. Past/future days have a stronger colored border, with text/icon distinctions so color is never the only cue. The single-food logging screen uses the same banner.

The banner reflects the effective consumed date used by the existing logging path, including an opened daily-note date, restored tray time and date-picker edits. Clearing the picker means the current time. The single-food Now/selected-day buttons also keep the picker display synchronized. Day comparisons use the local calendar, including UTC-midnight, year and daylight-saving boundaries; no execution defaults, storage schema or settings navigation changed. Labels use the device locale for the weekday/date. The banner refreshes when opening, changing the date or rerendering the tray; an idle menu spanning midnight refreshes on the next such interaction.

Native sun/moon/calendar icons are decorative; the polite, atomic status text carries the accessible meaning. Namespaced CSS wraps at narrow widths, reserves close-button space and keeps the compact search banner outside the scrollable content. Tests cover all three states, local time boundaries, mode changes, live picker changes and single-food shortcut synchronization. This backward-compatible clarity fix is a patch; minimum Obsidian remains 1.12.0. Final validation, test-vault UI results and artifact hashes are recorded in the release notes. Production installation remains the user's BRAT pull.

0.47.3 validation: 431 tests passed, zero failed; the optional live USDA test was skipped without a test key. The declared full suite and TypeScript build passed. Reloaded only Health in the test vault and visually checked today/sun, past/moon and future/calendar on the actual logging menu. At a measured 388 px modal width, the banner had no horizontal overflow and remained above the open review panel. Changing a future tray's picker to the past updated the banner immediately. The single-food screen likewise changed future → past → today using its picker and Now button, with the input synchronized. QA used an in-memory food and made no consumption writes or outbound provider calls; original pending settings were restored and runtime data.json remained byte-identical. The separate final production-mode build uses the shared test deployment helper and is followed by a named test-vault plugin reload. Physical iPhone testing remains user acceptance; production is untouched.


## 0.47.4 — Track nutrients without configuring property menus

Health owns nutrient storage and macro presentation. Creatine, alcohol, fiber, vitamins and minerals can be entered on a food/supplement label and logged without adding GCM property-menu definitions or Health goals. Open a macro view’s **Nutrients** disclosure to see the recorded totals and contributing foods. Goals remain optional; unconfigured nutrients have no invented target. Atomic notes still use GCM’s native-record storage bridge, but its property-menu configuration is not required for these amounts.

Inline Macros now includes recorded fiber, sugar, sugar alcohol, alcohol and sodium even when no goal exists for that nutrient, alongside its existing extended nutrient rows. Macros Bases now default **Show nutrients** to **Recorded nutrients**, supplementing property-selected rows with recorded nutrients from only the Base’s filtered food entries. **Selected properties only** preserves the prior explicit visibility behavior. Alcohol is selectable there even without a goal. Existing labels, targets, mapped property keys, order, date grouping, display rounding and full-precision saved values are preserved. **Nutrient rows** still controls collapsed, expanded or hidden presentation; hiding rows never deletes their data.

No GCM settings, property registrations, Health goals, existing Base files or stored nutrient values are changed. Only an explicitly selected Base view option persists in that Base’s configuration; absent options use the recorded-nutrient default without migration. Unknown extended nutrients remain absent and known zeroes remain present. Historical core totals do not distinguish unknown from zero, so unconfigured core rows are added automatically only for positive totals. Imported foods still need known label amounts; this does not infer missing nutrients.

Patch release for incomplete display of already-supported nutrition tracking. Minimum Obsidian remains 1.12.0. Regression coverage exercises saving/indexing/totals with no goals or property configuration, automatic Base rows and the explicit property-only mode, target preservation, unknown values and all requested nutrient categories.

Validation (2026-09-18): all 435 tests passed, one optional live USDA test skipped without its credential. TypeScript and the separate final production build passed; shared deployment reported `target=test`, followed by `plugin:reload id=tps-health` in the named test vault. The real Macros Base day renderer displayed synthetic fiber 3.5 g, alcohol 14 g, vitamin C 90 mg, magnesium 125 mg, creatine 2.5 g and known iron 0 mg with an empty goal/property selection. Expanding Creatine showed its contributing food and exact amount. A 388 px container had no horizontal overflow. In-memory UI fixtures were removed; no notes, settings or outbound provider calls were created, and Health runtime `data.json` stayed byte-identical. No physical iOS run or production installation is claimed.


## 0.48.0 — User-defined nutrients

The supported nutrients are now extensible, rather than limited to the built-in vitamins, minerals and supplements. In **Health → Food & goals → Custom nutrients**, enter any nutrient/measurement name and its unit, then choose **Add nutrient**. In a food’s editor, open **Vitamins, minerals & custom nutrients** and enter its amount per labeled serving. Log the food normally; serving conversion, recipes, atomic lines/notes, daily totals, nutrient details and macro contribution rows all use the same registered definition. No GCM property-menu definition or Health goal is required. The standard nutrients remain presets with their existing provider conversions.

Custom amounts are nonnegative additive quantities. Units are user-authored text (for example mg, ml or billion CFU); Health scales by food portions, never guesses conversions between custom units or assigns a custom amount a calorie contribution. Unknown amounts remain absent and known zero remains known. Custom nutrient definitions do not imply that a provider reports them; enter known label amounts manually. Existing rounding behavior remains display-only.

Definitions persist in Health’s new optional `customNutrients` array (empty by default), with a stable generated `healthNutrient_*` key, label, unit and optional archived flag. Numeric amounts use that key in existing food/log storage. Names can change without changing keys or values. Units are immutable to protect historical meaning; create a separate definition for another unit. Archive instead of deleting: archived definitions remain readable in totals and editable on foods already containing them, while being omitted from blank food editors. Settings synchronization/backup must include the definitions so other devices know their labels and units. Use 0.48.0+ on devices logging custom amounts. No existing nutrient keys, notes, defaults or GCM registrations are migrated.

The existing five settings destinations and default **Daily logging** route remain; the new controls extend **Food & goals** with direct name/unit inputs, an add action before the collection, and one selected editor. Selection/focus are transient; only definitions persist. Existing settings/mobile layout and the food editor’s single disclosure are reused. Macro rows still follow the existing collapsed/expanded/hidden preference and Base recorded-versus-selected mode. Atomic note storage still requires GCM’s record bridge; custom nutrient-menu configuration does not.

This is a backward-compatible feature release. Regression coverage uses arbitrary definitions created after module loading, including a unit outside the built-in mass units, and checks save/reload, serving scaling, native projections, atomic lines, deletion of a food’s amount, archive, stable units, unknown versus zero, Base selection, contributor totals and unchanged GCM catalogs. Minimum Obsidian remains 1.12.0.
