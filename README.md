# TPS Health

TPS Health treats daily notes as the durable health log and uses linked notes for reusable foods, recipes, and workout sessions.

See `DESIGN.md` for the broader researched workflow model covering food, recipes, meals, exercises, routines, serving sizes, and AI-assisted command flows.

## Daily Note Lines

Food logs are appended under the configured food heading:

```md
- [[Health/Foods/Greek yogurt|Greek yogurt]] - 1 serving [food:: Greek yogurt] [qty:: 1] [unit:: serving] [servings:: 1] [foodPath:: Health/Foods/Greek yogurt.md] [foodId:: food-...] [createdDate:: 2026-06-01T15:00:00.000Z]
```

Workout summaries are appended under the configured workout heading:

```md
- [tps-health:workout path="Health/Workouts/Workout 2026-05-31 10.30.md" startedAt=2026-05-31T15:30:00.000Z] [[Health/Workouts/Workout 2026-05-31 10.30]]
```

These lines are plain Dataview inline fields so they are easy to type manually and query without plugin state. Generated linked-food entries store the consumed instance, scaled known nutrients, source metadata, barcode, serving metadata, timestamps, and notes. Reusable nutrition, brand, source, barcode, serving metadata, and ingredient details still live on the linked food note as the editable source of truth. If both local food-note nutrition and inline macro fields are present, the inline macro fields are treated as explicit per-instance overrides so manual edits are reflected in rollups.

## Food And Recipe Notes

Reusable foods and recipes are Markdown files with frontmatter:

```yaml
---
tpsType: health-food
tpsHealthSchema: 1
name: "Greek yogurt"
servingAmount: 1
servingUnit: serving
calories: 120
proteinG: 15
carbsG: 8
fatG: 2
---
```

Recipes use `tpsType: health-recipe` and may include an `## Ingredients` section with links to food notes or inline food records. Both food and recipe notes are returned by the food logger search.

## Food Search And Creation

`Log food` opens as a tray-first logger with exactly three options: Barcode, Search, and My foods/recipes. Selecting Barcode opens the scanner immediately and starts the camera without an extra scan/start click; matched barcode foods are added back into the same tray. The scanner includes Flash and Flip camera controls when the camera is active, with flash depending on browser/media-track torch support. It probes for an exposed native barcode bridge on mobile/iOS-like runtimes before starting the web scanner, offers an explicit Apple Shortcut handoff on iOS-like runtimes, then tries native `BarcodeDetector` when available and ZXing with food-barcode hints over full-frame, cropped, upscaled, processed, and rotated candidates so small UPC/EAN labels are more likely to decode. The Barcode tab still keeps manual UPC/EAN lookup available, and the scanner modal still offers manual entry plus image scanning as fallbacks. Search is the external and local food database search tab, and active inline food drafts seed this search with their parsed query and amount. My foods/recipes shows recent/frequent foods plus saved local food and recipe notes without running an external search. Tapping a result adds it to the tray by default; `Review` still opens the single-food amount modal when a detailed one-item review is needed. Selected foods live in a sticky bottom tray that follows modal scrolling; it can be hidden to a compact count/macro row and restored with `Show`. Search covers local food/recipe notes, previously logged foods, curated common foods, USDA FoodData Central, and Open Food Facts branded products. Search ranks previously logged foods and local notes first, then closer name/brand token matches, branded results, and entries with fuller serving/macro data so exact groceries are not buried under generic matches. Matching barcode or name/brand candidates from multiple providers are collapsed into one result, preferring local notes and then the most complete candidate. Same-name results with matching per-100g/per-100ml macros are also collapsed so duplicate serving variants do not crowd the list. Natural-language food logging is intentionally deferred to future AI assistant workflows.

Search results can be logged directly or used as a starting point for a new local food. `Create from this` opens the custom food form prefilled with the selected food's brand, barcode, serving, macro, image, ingredient, and note metadata so the user can edit values before saving and logging. Saving from this flow upserts the local food by barcode or exact name/brand, then opens the log modal for that canonical local instance instead of creating a duplicate copy.

Open Food Facts search results are enriched from the full barcode product record before logging or cloning. This improves serving units such as `bar`, parses metric serving text such as `1 bar (50 g)`, and scales per-100g nutrition down to the serving size when serving-specific nutrition is missing. Implausible metric serving sizes from providers or saved notes are ignored so malformed/package-level values such as `18000 ml` do not become log units or serving labels.

Provider model:

- Local food and recipe notes are the canonical reviewed source for foods you actually log.
- Previously logged foods are boosted so repeated personal groceries outrank new external candidates.
- USDA FoodData Central is preferred for generic/common foods and stable nutrient profiles. Foundation Foods and SR Legacy are useful for non-branded foods; USDA Branded Foods updates monthly and is useful as a secondary packaged-food source.
- Open Food Facts is useful for barcode/branded coverage and images/ingredients, but its own API documentation says records are voluntarily contributed and not guaranteed accurate or complete. TPS Health treats these as candidates to review, enrich, and save locally rather than unquestioned source-of-truth rows.
- For higher-volume or more auto-updating packaged-food support, use a local cache fed by provider exports or a commercial provider with serving/measure support. The plugin should still keep a reviewed local food note once a food is logged.

The food search modal supports batch selection as the default flow. Tap several results to collect foods, adjust each amount/unit, optionally set one consumed time such as `2 hours ago`, then `Log selected` to write all entries with the same consumed timestamp. The same selected set can be saved as a recipe with aggregated nutrition; the created recipe opens in the normal log modal for review/logging.

When the GCM food-log button is enabled, it is shown as an apple icon-only action only on recognized daily notes. If logging starts from a daily note that is not today, the food log modal defaults the consumed date to the open daily note and offers explicit buttons for `Today` or the open note date before writing the log entry.

## Workout Files

A workout is one Markdown file:

```yaml
---
tpsType: health-workout
tpsHealthSchema: 1
title: "Workout 2026-05-31 10.30"
startedAt: 2026-05-31T15:30:00.000Z
---
```

Sets are appended as line records:

```md
- [tps-health:set id=set-... exercise="Bench press" endedAt=2026-05-31T15:40:00.000Z reps=8 weight=185 weightUnit="lb" rpe=8 restSeconds=90 dropSet=bench-drop-1]
```

Use the same `dropSet` id to link sets into a dropset. Superset grouping is reserved in the TypeScript schema as `supersetGroupId`; the next UI pass should expose exercise-level grouping once exercise blocks are editable as structured groups.

Unknown exercises are now promoted into exercise notes automatically when a set is logged, unless the API caller passes `createExerciseNote: false`.

Workout starts use the same daily-note date context as food logging. When `Start workout` is launched from a non-today daily note, the modal defaults the workout's daily-note target to the open note date and offers a `Today` choice. Session-note timestamps, daily workout parent lines, nested daily-note set lines, and optional daily workout summaries use the selected date target.

Workout daily-note placement is configurable through `Workout log heading`. Workout storage remains configurable through `Workout log target`, `Workout note body`, `Exercise layout in workout notes`, `Set notation`, and `Set line type`.

## Current Commands

- `TPS Health: Start workout`
- `TPS Health: Finish active workout`
- `TPS Health: Finish active workout and save template`
- `TPS Health: Save active workout template`
- `TPS Health: Create workout plan`
- `TPS Health: Log workout set`
- `TPS Health: Log food`
- `TPS Health: Open Food Log base`
- `TPS Health: Complete inline food log at cursor` completes only the current cursor line, and only when that line is an inline food draft with an explicit food signal such as a food link, a measurable amount/unit, or inline nutrition overrides.
- `TPS Health: Scan food barcode`
- `TPS Health: Create custom food`
- `TPS Health: Create recipe`

Active-workout commands require an active session. `Finish active workout`, `Finish active workout and save template`, and `Save active workout template` show `No active workout` and stop before opening follow-up modals or writing files when no workout is active.

## Barcode Flow

`Scan food barcode` opens a camera scanner with manual UPC/EAN entry and image upload fallbacks. In the food logger, choosing the Barcode tab opens this scanner and starts the camera immediately. On iOS, Apple's true VisionKit scanner is native app code and is not directly callable from an Obsidian community plugin webview unless Obsidian exposes a native bridge. TPS Health therefore probes for known native barcode bridge shapes, such as Capacitor barcode scanner plugins on `window`, before starting the web scanner; when no bridge exists, is cancelled, or errors, the status notes that the web camera scanner is being used and scanning continues normally. The scanner also shows an `Apple Shortcut` button on iOS-like runtimes. That button opens a Shortcut named `TPS Health Scan Barcode`; while the modal is open, TPS Health watches `TPS Health Barcode Scan.md` for a newly written numeric barcode, then sends it through the same barcode lookup flow and marks the inbox note processed so it does not loop. While scanning, `Flash` toggles torch mode on browsers/devices that expose it, and `Flip camera` restarts the stream against the opposite facing camera. The live scanner uses ZXing's `BrowserMultiFormatOneDReader` against the active video element as the primary continuous decoder with UPC/EAN/CODE_128 hints and short retry delays. If that path does not find a barcode quickly, a bounded backup loop tries guarded native `BarcodeDetector` support and ZXing over lower-center, center, side, upscaled, processed, and rotated canvas candidates. Keeping the barcode steady, well lit, and centered improves reliability.

Scanner tests can install fake barcode scanner adapters through the modal options object instead of touching real browser/device APIs. The adapter surface covers `requestCameraStream`, `createLiveReader`, `createCanvasReader`, `createNativeDetector`, `nativeBridgeScan`, and `navigatorInfo`. When an adapter is omitted, TPS Health falls back to the live Obsidian webview behavior: `navigator.mediaDevices.getUserMedia`, known native bridge globals, `BarcodeDetector`, and ZXing reader constructors. This keeps production scanning unchanged while allowing deterministic tests to exercise camera start, native bridge success/fallback, native detector, image/canvas decode, and platform-specific button logic without opening a real camera or constructing live scanner implementations.

Apple Shortcut setup:

1. Create an Apple Shortcut named `TPS Health Scan Barcode`.
2. Add `Scan QR or Barcode` and set it to scan barcodes.
3. Add `Open URLs` with an Obsidian URI that overwrites `TPS Health Barcode Scan.md` in this vault with the scanned value, for example `obsidian://new?vault=TishOS%20v0.1&file=TPS%20Health%20Barcode%20Scan.md&content=<Shortcut Scanned Code>&overwrite=true`.
4. If the built-in `obsidian://new` overwrite behavior is unreliable on the installed Obsidian version, the optional Advanced URI community plugin can be used instead with an overwrite URI such as `obsidian://advanced-uri?vault=TishOS%20v0.1&filepath=TPS%20Health%20Barcode%20Scan.md&data=<Shortcut Scanned Code>&mode=overwrite`.
5. Keep the TPS Health scanner modal open before running the Shortcut so the inbox watcher can receive the new note content.

After a barcode is read:

1. TPS Health checks Open Food Facts by barcode.
2. The user reviews the returned product values.
3. The user can create a local food note and immediately log it, or log without saving.
4. If a local note already has the same `barcode`, TPS Health reuses that note instead of creating a duplicate.

Food notes created from barcodes include source fields such as `brand`, `barcode`, `imageUrl`, serving data, and macros.

## Daily Rollups

When automatic daily rollups are enabled, each logged food recalculates daily-note frontmatter properties:

```yaml
---
cal: 520
protein: 42
carbs: 58
fat: 14
fiber: 6
sugar: 18
sodium: 620
healthUpdatedAt: 2026-06-01T15:00:00.000Z
---
```

Legacy visible rollup blocks using `<!-- tps-health-rollup:start -->` are removed the next time rollups run.

Daily frontmatter rollups only write food nutrient keys that are configured as health goals. Food log lines can still retain all known logged nutrients and metadata for later analysis, even when the daily note does not show those nutrients as properties.

## Food Log Base View

TPS Health registers a custom Bases view type, `tps-health-food-log`, named `Food Log`. It renders a dense food-log page from existing Markdown food bullets instead of converting entries into tasks or one-note-per-entry records.

The view respects the active Base query/filter result when Bases provides filtered files, then renders food log lines only from those files. If Bases data is unavailable or empty, it falls back to Health food sources: the configured single food log file, the configured daily-note folder, and the legacy `Dailynotes/` folder. When embedded in a daily note, it detects that note's daily-note date, filters rendered food entries to that day, and passes the same consumed-date context into `Log food` and `Barcode`. Entries are grouped by consumed date first, then daily-note/file date, then creation date. It includes quick controls for `Log food`, `Barcode`, `Refresh`, and opening the source line. `TPS Health: Open Food Log base` creates/opens a default `Food Log.base` file using filters for the configured food log file plus daily-note folders, and repairs only the old generated all-vault template or a file missing the custom view without replacing user filter edits.

Known limitation: native Bases table/list views operate on files and tasks, so they cannot directly row-render arbitrary non-task Dataview food bullets. The custom view is the compatibility layer for food entries while preserving the current Markdown bullet storage model.

## Settings

Settings are normalized deterministically on load and before save. Vault-specific configuration such as custom folders, food log target/path, workout log heading, health goals, provider options, and API keys is preserved even when it differs from source defaults. Obsolete persisted fields that are no longer part of `TPSHealthSettings`, including the legacy `foodLogHeading`, are stripped during this migration pass.

`rollupHeading` remains a typed setting intentionally. It is used only to find and remove old visible rollup blocks when daily frontmatter rollups run; it is not a sign that source defaults and vault config need to match.

`Default food log section` is intentionally blank by default. Blank keeps food entries unheaded and inserts daily-note entries immediately after frontmatter; `Food Log` is only the settings placeholder suggestion, not the persisted default.

- Daily note format and folder
- Workouts, workout plans, exercises, foods, and recipes folders
- Optional workout, workout plan, exercise, and food template paths
- Show food log button in TPS Global Context Menu
- Workout log heading and workout log target
- Workout note body, exercise layout, set notation, and set line type
- Rest timer mode: count up or count down
- Default rest seconds
- Default workout cooldown days
- Whether workout summaries are appended to daily notes
- Default food log section
- Food log target and single-file food log path
- Automatic daily frontmatter rollups
- Include branded food search results
- Health goals, calorie goal, protein goal, and activity goal minutes
- Open Food Facts User-Agent
- USDA FoodData Central API key

## Debug And Validation Notes

- 2026-06-18: Reviewed the active single-file food log. Current entries point to reusable notes for Light + Fit Greek Vanilla Yogurt Cup, Apple, raw, with skin, and Barebell wild cherry. The first two include metric serving metadata; Barebell wild cherry logs correctly as one serving but should be normalized to `servingUnit: "bar"` plus serving grams when the exact label is available.
- 2026-06-18: Build validation passed with `npm run build`. Obsidian UI verification after reload confirmed `pure protein bar` returns Open Food Facts Pure Protein results and exposes `Create from this` on result rows.
- 2026-06-18: Added barcode enrichment before logging/cloning Open Food Facts search results, bottom-sheet mobile modal positioning, scaled nutrient/source fields on log lines, and goal-filtered daily frontmatter rollups. Build validation passed with `npm run build`.
- 2026-06-18: Updated the GCM food-log action to be icon-only via scoped CSS, visible only on recognized daily notes, and to pass the open daily note date into food logging with a `Today` versus open-date choice. Build validation passed with `npm run build`.
- 2026-06-18: Added multi-food selection in the food search modal with shared consumed-time parsing, batch logging, and recipe creation from the selected foods. Build validation passed with `npm run build`.
- 2026-06-23: Updated the Food Log Bases view so daily-note embeds filter food bullets to the embedded note's day and log/barcode actions use that same date context.
- 2026-06-18: Added open-daily-note date targeting to workout starts and exposed the workout daily-note heading setting. Build validation passed with `npm run build`.
- 2026-06-24: Guarded active-workout template commands so missing active workouts show `No active workout` before any save modal opens. Validation passed with `npm test`.
- 2026-06-24: Added deterministic settings normalization so stale persisted keys such as `foodLogHeading` are removed while live vault config values are preserved; `rollupHeading` remains typed for legacy rollup cleanup. Validation passed with `npm test`.
- 2026-06-25: Clarified the blank default food-log section contract and aligned scanner-modal barcode validation so empty input reports required while non-empty invalid input reports invalid UPC/EAN format. Validation passed with `npm test`.
- 2026-06-18: Switched the daily-note-only GCM food action to a clearer apple icon with a stable icon-only touch target. Build validation passed with `npm run build`.
- 2026-06-18: Added visual-viewport keyboard handling to food/search/create modals and changed mobile food modals from bottom sheets to top-anchored sheets so the iOS keyboard has room below focused inputs. Build validation passed with `npm run build`.
- 2026-06-18: Cleaned food search ranking and Open Food Facts normalization. Logged foods now receive a strong ranking boost, external branded search runs alongside local/curated/USDA search, result rows show metric serving data, and OFF per-100g nutrients are scaled to parsed serving grams/ml when per-serving nutrients are unavailable. Build validation passed with `npm run build`.
- 2026-06-20: Researched provider reliability. USDA FoodData Central remains the best free canonical source for generic foods and monthly branded updates; Open Food Facts remains broad and open but must be treated as user-contributed candidate data. Updated search dedupe to collapse matching provider candidates, changed `Create from this` to preserve the real food name, and changed the custom-food save/log flow to upsert canonical local foods by barcode or exact name/brand before logging.
- 2026-06-20: Changed food logging to a tray-first flow with recent/frequent and local quick picks on open. Result clicks now add to the tray by default, with `Review` preserving the old single-food modal path. Dedupe now also collapses same-name foods when their per-100g/per-100ml macro profiles match, keeping the richest/local record.
- 2026-06-20: Scoped food log unit options to the food's serving type. Liquids now show serving/cup/ml/fl oz, gram-based foods show serving/g/oz plus their own count unit when present, and unrelated count units such as bar/slice/piece are no longer offered globally. Generic `serving` options now display the normal serving size, such as `serving (355 ml)`. Open Food Facts drink records and existing local drink notes that only provide per-100ml nutrition now get a conservative normal serving inferred before macros are computed: 355 ml for beer/seltzer/canned alcoholic drinks and 240 ml for other likely beverages.
- 2026-06-20: Added grocery-search query expansion and curated seeds for common protein-chip products. Colloquial searches such as `protein doritos` now also search Quest/Nacho protein chip variants and can return local curated Quest/Wilde protein chip entries even when external providers do not understand the nickname.
- 2026-06-20: Tightened food search matching so multi-word searches require every typed token to appear somewhere in the candidate name, brand, ingredients, or curated aliases. This prevents broad expanded-provider results like plain protein bars or ordinary Doritos from showing for `protein doritos`.
- 2026-06-20: Promoted food aliases to a first-class `aliases` frontmatter property. In-vault food notes can now store aliases as YAML arrays or comma-separated text, and search uses those aliases for matching/ranking instead of storing alias text in notes.
- 2026-06-20: Improved partial matching for awkward provider names by inferring practical aliases from separated names. For example, a saved food named `Premier protein - Post Cereal` is searchable as `Premier protein cereal` before the whole provider name is typed; new/upserted food notes persist those inferred aliases in `aliases`.
- 2026-06-21: Refined the daily-note food-log action so command and GCM button launches share a guarded opener. Added a capture-phase tap fallback for the rendered GCM `Log food` control so the first mobile/desktop tap opens the logger instead of requiring a second press.
- 2026-06-22: Removed natural-language food parsing from the logger. The Log food modal now exposes Barcode, Search, and My foods/recipes only; natural-language food logging is deferred to future AI assistant workflows.
- 2026-06-22: Changed the food logger Barcode tab to open the scanner and start the camera immediately, with duplicate scanner modals guarded and manual/image fallback paths preserved.
- 2026-06-22: Added scanner Flash and Flip camera controls. Flash uses browser torch support when available; Flip camera restarts the scan stream with the opposite facing-mode constraint.
- 2026-06-22: Improved barcode decode robustness for small or vertical labels by adding native BarcodeDetector when available, ZXing UPC/EAN hints, and cropped/upscaled/rotated decode candidates for live camera and image fallback scans. Tuned live scanning to use ZXing's video-element OneD reader first, then start the custom crop loop as a delayed backup without overlapping async decode work.
- 2026-06-23: Added serving-size sanity guards for food logging. Saved food notes and Open Food Facts imports now drop impossible single-serving metric metadata, preventing labels such as `serving (18000 ml)` and avoiding future persistence of malformed serving sizes. Validation: `npm test` after rebuild.
- 2026-06-21: Refined the logger first screen into separate food entry lanes. UPC/EAN lookup and scanning stay separate but add matched foods to the batch tray with consumed-time context preserved.
- 2026-06-21: Converted the food logger lanes into tabs and moved selected foods into a sticky bottom tray. The tray stays available while scrolling, supports compact hide/show behavior, and keeps logging controls close to the selected foods.

## Public API

TPS Health exposes a typed API for commands, other TPS plugins, and future AI-assisted logging.

Access it from Obsidian plugin code:

```ts
const api = app.plugins.plugins["tps-health"]?.api;
```

It is also mirrored at:

```ts
const api = app.tpsHealth;
```

Current API surface:

```ts
api.getSchema()
api.searchFoods(query)
api.lookupBarcode(barcode)
api.createFood(input)
api.upsertFood(input)
api.createFoodFromLabel(input)
api.findOrCreateFood(item)
api.logFoodByName(input)
api.searchExercises(query)
api.createExercise(input)
api.upsertExercise(input)
api.findOrCreateExercise(input)
api.searchWorkoutPlans(query)
api.createWorkoutPlan(input)
api.upsertWorkoutPlan(input)
api.findOrCreateWorkoutPlan(input)
api.logFood(input)
api.startWorkout(input)
api.finishWorkout(input)
api.logSet(input)
api.getActiveWorkoutPath()
api.getActiveWorkout()
api.getSettings()
api.getDailyRollup()
api.updateDailyRollup()
api.getMetricRenderConfigs()
api.getMetricRenderConfig(propertyKey)
```

Example AI-assisted food log:

```ts
await app.tpsHealth.logFood({
  query: "greek yogurt",
  quantity: 1,
  unit: "serving",
  section: "",
  createFoodNote: false
});
```

Example barcode-backed note creation and logging:

```ts
await app.tpsHealth.logFood({
  barcode: "012345678905",
  quantity: 2,
  unit: "serving",
  section: "Food Log",
  createFoodNote: true
});
```

Example workout logging:

```ts
await app.tpsHealth.startWorkout({ title: "Push day" });
await app.tpsHealth.logSet({
  exercise: "Bench press",
  reps: 8,
  weight: 185,
  weightUnit: "lb",
  rpe: 8
});
await app.tpsHealth.finishWorkout();
```

## Validation

- 2026-06-24: Added fake-vault/provider integration coverage for no-write cancellation, canonical food upsert, single-file food logging, daily-note food logging, and recipe note creation. `npm test` passed (34 pass, 1 live USDA skip) and ran the nested production build.
- 2026-06-24: `npm test` passed (30/30) and ran the nested production build.
- 2026-06-24: `npm run build` passed.
- No Obsidian UI verification was performed in this pass.
