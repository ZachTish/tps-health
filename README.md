# TPS Health

TPS Health provides whole-note food, activity and workout records, nutrition calculations, and interactive logging. Version **9.0.0** requires Obsidian **1.12.0** or newer.

## Start here

Install the public numeric release with BRAT from [ZachTish/tps-health](https://github.com/ZachTish/tps-health). Configure food goals and reusable-note destinations in Health settings. Core Daily notes supplies the daily-note naming convention; GCM owns shared record identity, classification and log destinations.

Use **Log food** to select a saved food, recipe, catalog item, barcode or online result, review its serving and date, and save a whole-note food entry. Workouts use whole-note sessions, reusable plans/exercises and explicit set controls. Optional `tps-health-macros` blocks read those records; ordinary note navigation does not normalize or repair them.

## Bases and Canvas

The standalone **Health** dashboard, its command and ribbon icon are removed. Health no longer registers that custom view. Existing records, authored Bases, Canvas files and settings are untouched; no replacement page or Base is generated on startup. Close any saved obsolete dashboard tab and open your own Base or Canvas.

A native Macros Base can filter food-entry notes, group by the consumed date, and sum the configured calorie/protein/carbs/fat fields. Such summaries are owned by Obsidian and update from note metadata. Health continues to provide Log food, Log activity, workout controls, tracked-nutrient rules and goal/property APIs. Optional embedded Health blocks remain supported; removing the standalone view does not rewrite existing notes that contain them.

## Settings and ownership

The hub shows one destination at a time:

| Destination | What it configures |
| --- | --- |
| **Daily logging** (default) | Rings/rows, lower nutrient rows, the GCM food-log shortcut and a Core Daily notes settings handoff. |
| **Food & goals** | Nutrient tracking, targets, independent primary totals and lower bars, energy settings, custom nutrients and branded search. |
| **Workouts** | Whole-note controls, rest timing, workout estimates and calendar timing properties. |
| **Note library** | Reusable food/recipe/exercise/workout-plan destinations, supported templates and identification. GCM v2 owns kinds; older installations retain their supported identification controls, including Exercise tag. |
| **Integrations & advanced** | Food databases, the GCM handoff, Health property names, AI connection handoff, explicit earlier-log review/import and diagnostics. |

**Food databases opens directly in Health.** It uses the existing provider panel, settings keys and secret references; Controller can be disabled or absent. Opening, switching and closing settings performs no provider requests or saves. Provider credentials are not copied to a new store. The existing `api.connectionSettings` renderer remains available to current consumers.

USDA credentials use **device-local Obsidian SecretStorage**. References are ordered, editable and removable through the existing controls. The `DEMO_KEY` fallback has much lower public limits. Open Food Facts needs no credential. Editing references uses Health's existing settings-save owner; opening the panel does not fetch food. AI-assisted Describe still uses AI Gateway and the existing Controller connection-settings handoff; neither is required for ordinary food setup or logging.

Custom goal JSON, Templates, Property names and Earlier inline logs are the only intentional disclosures, all one level deep. One property-name editor is mounted at a time; Apply uses the existing confirmed migration. No automatic migration runs when browsing settings. The route and scroll position are transient, as are selected editors and disclosures; no navigation state is persisted.

The mobile route hub scrolls horizontally, labels wrap and control grids stack. Controls are native, selected routes expose `aria-pressed`, keyboard focus is restored after navigation, and settings CSS is Health-scoped. Leaving the provider page disposes its existing panel so late saves cannot repaint the abandoned page.

## Food accuracy and tracked nutrients

- Search starts with saved foods/recipes and the existing catalog. Online search is explicit and uses USDA FoodData Central and Open Food Facts. Saved matches and each completed provider appear while the other provider is pending. Query changes and closing reject late results; updates preserve the selected food and portion. Edamam and Nutritionix are removed.
- Open Food Facts search rows are identity previews. Selecting one loads its current barcode record before nutrition can be saved; missing values remain unknown. Review serving units, source and warnings.
- The sourced catalog distinguishes Michelob ULTRA Superior Light Beer from similarly named products. Its original US 12 fl oz serving uses the recorded manufacturer label: 95 kcal, 0.6 g protein, 2.6 g carbs and 0 g fat. Alcohol grams are labeled as an ABV/volume estimate; other sizes and variants are not silently substituted.
- Food entries and reusable food/recipe definitions write only selected tracked nutrients. Enabling a nutrient does not backfill earlier entries; update a definition explicitly and future logs can include it.
- Primary totals and lower nutrient bars are independent display choices for the same target. A nutrient may appear in both without being counted twice. Hiding it does not stop tracking.
- Macro input accepts grams or energy using the existing conversion factors. For alcohol, 260 kcal / 7 gives approximately 37.14 g. Reported package energy remains distinct from estimated energy.
- Recipe nutrition follows its declared yield/weight. A nutrient is known only when its required ingredients report it; known zeroes remain zeroes.

## Barcode and device limitations

The scanner has camera, image import and manual-barcode routes. Torch availability depends on the device. It no longer shows an Apple Shortcut button; the Shortcut inbox reader, poller and mailbox writer were removed in 6.0.0. Existing mailbox notes are left untouched.

On iOS, Apple's true VisionKit scanner is native app code; the plugin probes for known native barcode bridge shapes. When no bridge exists, is cancelled, or errors, the web-camera path remains available. Portrait locking is requested during scanning. Physical camera, keyboard and touch behavior require separate real-device acceptance; desktop tests do not establish it.

Provider coverage, serving data, rate limits and unknown nutrients remain visible limitations. Routine tests use synthetic responses; the optional live USDA check needs an explicit test credential. Opening settings is never a connectivity test.

## Records and APIs

GCM owns shared identity/title/created/modified fields, classification and the destination for new log notes. Health owns Health-specific mappings, nutrition, food-provider configuration and workout behavior. Mapping changes are explicit, previewed migrations; a display change does not convert notes. Supported historical readers and one-time review/import remain available.

The enabled plugin exposes `app.tpsHealth`/`api`; [src/api.ts](src/api.ts) is the current typed contract. Lookup, exact-food logging, activities, workout plans and sessions retain their existing owners. Prefer a barcode or exact food-note path for deterministic logging. The removed `getDailyRollup` API is not supported; use indexed `getDailyFoodMacroTotals(dateIso)`.

The retired Macros Base and `tps-health-food-log` Base layouts are not registered. Use ordinary Bases for note properties and summaries, or the optional macros block for nutrition totals; GCM's generic table can inspect supported historical inline records. Do not retire an interactive Health workflow merely because an ordinary Bases table can display its records.

## Development and validation

Use the workspace source map and release checklist. Each repository remains independently buildable; `npm test` and a separate final `npm run build` never deploy or reload. Deployment to the named test vault is explicit. Cross-plugin tests use current sibling sources, not historical Dev checkouts. Never copy runtime settings or private data into source.

Focused checks execute the existing food-provider panel with Controller absent, preserve ordered synthetic secret references, verify disposal, and count zero settings saves/provider requests on open. Food-search checks use the actual search/modal methods with controlled provider responses: both arrival orders, local selection, portions, cancellation, timeouts, request counts and unchanged final ranking. Existing serving/nutrition and native-index operation-count checks remain. These source/host tests do not establish installed response times. Release acceptance requires the full suite, separate final build and installed test-vault UI inspection; see [9.0.0 validation and release status](release-notes/9.0.0.md).

## Release history

**9.0.0** removes the standalone dashboard and includes the previously unpublished fixes for the unnecessary Controller dependency for food setup and the slow-provider display barrier in food/recipe searches. Selecting an ingredient releases the existing search busy state. It reuses existing settings, query tokens and requests, adds no background work, and retains both the panel API and complete-result search API. The README is now a current specification; contradictory historical setup claims remain only as dated evidence.

Historical narratives and receipts remain in [the preceding README in Git history](https://github.com/ZachTish/tps-health/blob/42c569927f7a08d365a3f0549701e9bde6cf0e55/README.md), [REFERENCE.md](REFERENCE.md), [release notes](release-notes/) and [GitHub releases](https://github.com/ZachTish/tps-health/releases). They do not override the current contract. Production installation and physical-phone acceptance are separate from a test-vault release.
