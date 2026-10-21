# TPS Health

TPS Health provides whole-note food, activity and workout records, nutrition calculations, and interactive logging. Version **10.1.1** requires Obsidian **1.12.0** or newer.

## Start here

Install the public numeric release with BRAT from [ZachTish/tps-health](https://github.com/ZachTish/tps-health). Configure food goals and reusable-note destinations in Health settings. Core Daily notes supplies the daily-note naming convention; GCM owns shared record identity, classification and log destinations.

Use **Log food** to select a saved food, recipe, catalog item, barcode or online result, review its serving and date, and save a whole-note food entry. Workouts use whole-note sessions, reusable plans/exercises and explicit set controls. Optional `tps-health-macros` blocks read those records; ordinary note navigation does not normalize or repair them.

The workout set dialog leaves the keyboard closed on opening, choosing an exercise and logging another set. Tap or tab into a field to edit it. Previous-set defaults and repeat logging stay available; saving clears only the explicit rest override. No new setting or record migration is needed.

## Bases and Canvas

The standalone **Health** dashboard, its command and ribbon icon are removed. Health no longer registers that custom view. Existing records, authored Bases, Canvas files and settings are untouched; no replacement page or Base is generated on startup. Close any saved obsolete dashboard tab and open your own Base or Canvas.

**Health goals are editable goal notes.** Food & goals → Move goals to notes adopts existing settings targets once, preserving all configured values, labels, units, colors and primary/secondary display choices. After adoption, `goalStorage: notes` is the only persisted selection; `healthGoals`, `calorieGoal`, `proteinGoalG` and `activityGoalMinutes` are removed from settings. No target values are copied into food entries. Startup never migrates notes. A partial adoption leaves created notes recoverable and refuses conflicting values before switching authority.

**Open food comparison** (also the existing Open Food Log base command) opens `Food & Goals.base`, an ordinary Obsidian table with Today and All tracked nutrients today views. Food rows calculate current nutrient amounts from their linked food definition and consumed portion; each target row links to its goal note. Column summaries compare the total to the minimum, maximum or range and report the amount below/remaining/over. Unknown nutrient values report a known subtotal and incomplete comparison, never zero or an asserted goal success. Duplicate/invalid targets are reported. Food dates are compared as local calendar days.

The goal rows participate in the same query as the logs. Their formula links include the target bounds, so an edit invalidates the native summary. Renaming or moving a goal, editing its bounds, and adding/editing/deleting today's logs update the open Base without regenerating it. Goal identity is the `healthGoal` metric property, independent of filename/folder. No backlink scan, maintenance writer, copied rollup, new watcher or background repair is used. Existing Health metadata discovery also projects goal notes; unchanged/unrelated events do not emit goal updates.

The initial goal destination is `Health Goals/`; goals may subsequently live anywhere. `Health Goals.base` edits `goalMinimum`, `goalMaximum`, `goalUnit` and `goalLabel` directly. Blank bounds mean track only; `goalEnabled: false` stops that metric's future writes while retaining its note and existing data. `goalColor`, `goalPrimary` and `goalSecondary` configure the optional Health blocks. GCM retains ownership of shared note identity. Goal fields are Health-owned; no GCM recognition rules are silently installed.

**Edit portions in a Base.** Newly created Food & Goals Bases expose **Amount consumed** (`quantity`) and **Unit** (`unit`) beside calculated nutrient columns. Set 0.5 cup, 2 cans, or 150 g using the linked food’s declared serving. Fractions, zero and numeric label values stored as quoted text are supported. Native formulas read the linked food’s nutrition and scale it with the same serving/weight/volume rules as Health; grams and milliliters are never interchangeable without a declared basis. Explicit g/ml serving labels override older auxiliary weights. The open Base, summaries and goal comparisons update after portion edits, without regenerating the Base or writing macros back into notes. Native Bases does not currently invalidate an already-open food row solely when the linked food’s label changes elsewhere; reopen the Base after editing that source directly. Health’s explicit food-definition editor retains its existing linked-entry update behavior. These ordinary formulas also work when Health is disabled.

Calculated columns are read-only; edit the amount/unit to change consumption or open the linked food to correct its per-serving label. Existing saved nutrient fields remain historical snapshots. Missing recorded nutrients remain unknown; enabling a new nutrient does not fill old logs. Invalid amounts or incompatible units show **Check amount or unit** and unknown macros. Logs without a usable food link retain their recorded totals and visibly say they need a food link before they can scale. No baseline is guessed from an old amount, and no automatic source link or repair writer is installed.

The comparison Base is created once with the nutrient columns and physical food-property mappings active at creation. Existing authored Bases, including Macros, are never repaired or replaced by opening a command. Updating an existing Base’s portion columns/formulas is an explicit configuration change; user-authored views, filters and grouping stay owned by that Base. To show an additional nutrient added later, add its column/formula to that Base or create another authored view; target edits do not require this. Activity and other non-food goals remain in the Goals Base; the food comparison does not mix activity totals into nutrition. Current recurring targets apply to the selected day, not historical effective-date snapshots. Bases continue working with Health disabled; food logging/interactive editing still uses Health and GCM.

## Settings and ownership

The hub shows one destination at a time:

| Destination | What it configures |
| --- | --- |
| **Daily logging** (default) | Optional Health block rings/rows and lower nutrient rows, the GCM food-log shortcut and a Core Daily notes settings handoff. |
| **Food & goals** | Nutrient tracking, targets, independent primary totals and lower bars, energy settings, custom nutrients and branded search. |
| **Workouts** | Whole-note controls, rest timing, workout estimates and calendar timing properties. |
| **Note library** | Reusable food/recipe/exercise/workout-plan destinations, supported templates and identification. GCM v2 owns note types and inline property visibility. The existing-workout folder appears only for folder matching. Older installations retain their matching-mode controls; food/workout tags appear only for tag matching, while Exercise tag remains independent. |
| **Integrations & advanced** | Food databases, the GCM handoff, Health property names, AI connection handoff, explicit earlier-log review/import and diagnostics. |

**Tracking, recognition and display are separate choices.** Food & goals selects nutrients to save in future food records and their targets. Note library links to GCM → Properties: Records identifies note types; Custom fields controls inline property visibility. Hiding a GCM field does not disable Health tracking. The supplied native Bases read the same goal notes; Health settings do not rewrite an existing Base. Daily logging appearance applies only to optional embedded Health blocks.

The energy estimate’s **Activity input filter** selects existing notes to read for that calculation only. It does not define a GCM record type, migrate notes or change their properties. Choose individual activities or daily summaries to avoid double counting. Its property/tag fields remain conditional on the selected energy method and input filter.

**Food databases opens directly in Health.** It uses the existing provider panel, settings keys and secret references; Controller can be disabled or absent. Opening, switching and closing settings performs no provider requests or saves. Provider credentials are not copied to a new store. The existing `api.connectionSettings` renderer remains available to current consumers.

USDA credentials use **device-local Obsidian SecretStorage**. References are ordered, editable and removable through the existing controls. The `DEMO_KEY` fallback has much lower public limits. Open Food Facts needs no credential. Editing references uses Health's existing settings-save owner; opening the panel does not fetch food. AI-assisted Describe still uses AI Gateway and the existing Controller connection-settings handoff; neither is required for ordinary food setup or logging.

Templates, Property names and Earlier inline logs are the only intentional disclosures, all one level deep. One property-name editor is mounted at a time; Apply uses the existing confirmed migration. No automatic migration runs when browsing settings. Hidden folder/tag values are retained unchanged; switching matching modes restores their controls. Custom goal JSON is retired; goal-note properties replace that competing settings editor. The route and scroll position are transient, as are selected editors and disclosures; no navigation state is persisted.

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

Camera and image decoding support upright, sideways, upside-down and diagonal UPC/EAN labels without turning the phone. The shared ZXing reader rotates luminance pixels with the correct rectangular dimensions; it does not use the broken canvas quarter-turn in ZXing browser 0.2.1. Existing lazy diagonal assistance remains bounded, and image imports try whole-frame rotations before crops so an angled label is not clipped. A missed canvas is decoded once. Clear focus, the complete barcode and sufficient lighting are still required.

On iOS, Apple's true VisionKit scanner is native app code; the plugin probes for known native barcode bridge shapes. When no bridge exists, is cancelled, or errors, the web-camera path remains available. Portrait locking is a best-effort layout convenience, not a decoding requirement; an unavailable lock does not ask the user to change device settings. Physical camera, keyboard and touch behavior require separate real-device acceptance; desktop tests do not establish it. Decoder regressions use actual ZXing on synthetic UPC-A/EAN-13 pixels, including rectangular portrait/landscape frames, offsets, a full turn, blank frames and invalid checksums; browser QA also exercises the real canvas transformations and scanner lifecycle.

Provider coverage, serving data, rate limits and unknown nutrients remain visible limitations. Routine tests use synthetic responses; the optional live USDA check needs an explicit test credential. Opening settings is never a connectivity test.

## Records and APIs

GCM owns shared identity/title/created/modified fields, classification and the destination for new log notes. Health owns Health-specific mappings, nutrition, food-provider configuration and workout behavior. Mapping changes are explicit, previewed migrations; a display change does not convert notes. Supported historical readers and one-time review/import remain available.

The enabled plugin exposes `app.tpsHealth`/`api`; [src/api.ts](src/api.ts) is the current typed contract. Lookup, exact-food logging, activities, workout plans and sessions retain their existing owners. Prefer a barcode or exact food-note path for deterministic logging. The removed `getDailyRollup` API is not supported; use indexed `getDailyFoodMacroTotals(dateIso)`.

The retired Macros Base and `tps-health-food-log` Base layouts are not registered. Use ordinary Bases for note properties and summaries, or the optional macros block for nutrition totals; GCM's generic table can inspect supported historical inline records. Do not retire an interactive Health workflow merely because an ordinary Bases table can display its records.

## Development and validation

Use the workspace source map and release checklist. Each repository remains independently buildable; `npm test` and a separate final `npm run build` never deploy or reload. Deployment to the named test vault is explicit. Cross-plugin tests use current sibling sources, not historical Dev checkouts. Never copy runtime settings or private data into source.

Focused checks execute the existing food-provider panel with Controller absent, preserve ordered synthetic secret references, verify disposal, and count zero settings saves/provider requests on open. Food-search checks use the actual search/modal methods with controlled provider responses: both arrival orders, local selection, portions, cancellation, timeouts, request counts and unchanged final ranking. Existing serving/nutrition and native-index operation-count checks remain. These source/host tests do not establish installed response times. Release acceptance requires the full suite, separate final build and installed test-vault UI inspection; see [10.0.0 validation and release status](release-notes/10.0.0.md).

Settings coverage also executes the current and older GCM branches across all four matching modes, checks conditional folder/tag visibility, preserves inactive values, and verifies focus restoration. Installed test-vault inspection covers all five routes, the actual GCM handoff, energy-method/filter visibility, one-level disclosures and a narrow desktop settings window. Synthetic recognition configurations are temporary; no settings are saved. Narrow desktop checks do not establish physical-phone acceptance.

## Release history

**10.0.0** makes adopted goal notes canonical, replaces the old inline Food Log Base generator with native food/goal comparisons, and removes the separate custom-goal JSON editor. Settings schema 10 prevents older Health versions from overwriting the adopted settings. Older devices must reload the updated plugin before goal editing or food logging.

**9.0.1** clarifies Health nutrient tracking/targets, GCM note types/inline visibility and Bases presentation. Unused folder/tag controls are hidden by matching mode; inactive values and all behavior remain supported. Energy activity filters are explicitly scoped to their read-only calculation.

**9.0.0** removes the standalone dashboard and includes the previously unpublished fixes for the unnecessary Controller dependency for food setup and the slow-provider display barrier in food/recipe searches. Selecting an ingredient releases the existing search busy state. It reuses existing settings, query tokens and requests, adds no background work, and retains both the panel API and complete-result search API. The README is now a current specification; contradictory historical setup claims remain only as dated evidence.

Historical narratives and receipts remain in [the preceding README in Git history](https://github.com/ZachTish/tps-health/blob/42c569927f7a08d365a3f0549701e9bde6cf0e55/README.md), [REFERENCE.md](REFERENCE.md), [release notes](release-notes/) and [GitHub releases](https://github.com/ZachTish/tps-health/releases). They do not override the current contract. Production installation and physical-phone acceptance are separate from a test-vault release.
