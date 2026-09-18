# Food search data audit — 2026-09-18

Scope: TPS Health 0.46.4 source, the contained test-vault catalogue, all 42 built-in foods, USDA and Open Food Facts ingestion, search/ranking/deduplication, barcode lookup, import persistence, and result presentation. Changes ship in 0.47.0. This is a software/data-contract audit, not laboratory verification of foods or an audit of production notes.

## Findings and implemented controls

| Finding in 0.46.4 | Consequence | 0.47.0 behavior |
| --- | --- | --- |
| Saved notes received only a 45-point boost; built-ins received 80 | An exact/popular database match could outrank a matching saved food | Relevant saved notes form the first ranking tier, before database/built-in results; relevance filtering still applies |
| Deduplication could transplant another provider's serving/nutrition while retaining the first source label | Nutrition and provenance could disagree; saved nutrition could be replaced in memory | Saved notes retain their complete authored record. Distinct saved paths remain distinct. External merges keep the source/receipt of the retained nutrition |
| Local barcode enrichment could write a supposedly better serving into an existing food note | A lookup could silently change a user's saved nutrition | Search, lookup and reuse do not update local notes. Explicit editor/duplicate-review saves remain the update path |
| Null, blank, boolean and negative core values were loosely coerced | Missing values could become zero or invalid amounts | Strict finite nonnegative numeric parsing for provider and food-note nutrition; genuine zero is retained |
| Default templates and note updates filled absent core nutrients with zero | Unknown data appeared complete after saving | Unknown core values are omitted; custom template placeholders remain blank; editing can remove a previously known value |
| Search required a positive macro or extended nutrient | Water/zero labels, calorie-only and sodium-only entries could disappear | Any explicitly reported valid tracked nutrient, including zero, makes a record searchable; empty records are excluded |
| OFF alcohol percentages were copied/scaled as grams | Alcohol amounts could be wrong by several times | Convert ABV using a known volume serving and the existing 0.789 g/ml ethanol convention. Without volume, grams remain unknown |
| OFF records with kJ-only energy or salt-only labels lost usable information | Energy/sodium completeness was reduced | kJ → kcal at 4.184; salt → sodium at 2.5 and g → mg. Explicit kcal/sodium, including zero, win |
| USDA core rows ignored units and detail-row structure | Wrong scale or missing known quantities | Nutrient-ID identity, compatible mass conversion, kcal/kJ handling, and search/detail shapes are supported; incompatible explicit units are ignored |
| OFF carbohydrate amounts could be inferred as polyols merely from an ingredient mention | Sugar alcohol and derived energy could be fabricated | Only reported aggregate polyols are imported. An explicit aggregate zero wins over subtypes. Ingredient names and incomplete subtype totals are not converted to total polyols |
| A named polyol ingredient selected the energy factor for the entire blend | Mixtures could receive an incorrect factor | Generic polyol factor is explicitly an estimate. Imported reported energy is preserved; no calorie rewrite based on a 4/4/9 check |
| OFF standard versus total carbohydrate semantics were not distinguished | Fiber conventions differ across regions/sources | Prefer a separately reported total-carbohydrate field. Otherwise retain the provider value with a definition caveat; do not invent a fiber conversion |
| Provider IDs, dates, data types and quality flags were discarded | Users could not assess age, origin or upstream warnings | Optional import receipt retains provider, record ID, dataset, source URL, retrieval/update date, and warnings |
| Built-in foods had no source citations, dates or validation evidence | Handwritten estimates were presented and ranked as if authoritative | All built-ins are labeled unverified estimates, receive a ranking penalty, cannot replace an identified duplicate, and are a barcode fallback only after a confirmed provider miss |
| No search-level completeness/plausibility explanation | Incomplete or impossible values looked normal | Each result has calorie/macro coverage, a review indicator, and keyboard/touch-accessible data details with tracked-nutrient count, unknowns, source receipt and plausibility warnings |

Plausibility checks warn for nutrients exceeding a mass serving, implausible energy per gram, sugars/polyols exceeding carbohydrate, invalid values, and OFF serving/per-100 disagreements. They do not certify a record or reject legitimate fiber/alcohol/label-rounding differences. Reported energy is kept, including through import-aware API review saves. Completeness is a count of reported fields, not an accuracy percentage or a diet adequacy score.

## What established apps do

| Application | Documented practice | Applied in TPS Health |
| --- | --- | --- |
| Cronometer | Uses documented research/analytical sources and reviews submissions; explains that completeness differs from accuracy and missing values can undercount nutrient totals. [Database sources](https://cronometer.com/features/accurate-databases.html), [data confidence](https://support.cronometer.com/hc/en-us/articles/360042550452-Data-Confidence-Scores) | Expose source and field coverage separately; preserve unknowns; label unsourced estimates. No claim of access to its licensed databases or human-review team |
| MacroFactor | Describes controlled standard foods and verified branded data. Submission workflow reviews product/label evidence, identity, serving and macro plausibility; label scans require user review. [Database](https://help.macrofactorapp.com/en/articles/46-food-search-database), [submissions](https://help.macrofactorapp.com/en/articles/246-how-to-submit-new-or-updated-foods), [label scanner](https://help.macrofactorapp.com/en/articles/213-label-scanner) | Preserve record identity and serving pairs, add plausibility/source details, retain explicit local review. No uploads or public food submissions are made by this change |
| MyFitnessPal | Check marks indicate review against completeness/accuracy criteria, but do not guarantee correctness; users can report inaccurate entries. [Check-mark explanation](https://support.myfitnesspal.com/hc/en-us/articles/360032273292-Check-Marked-items), [corrections](https://support.myfitnesspal.com/hc/en-us/articles/360032622691-Some-food-information-in-the-database-is-inaccurate-Can-I-edit-it) | Avoid a blanket verified badge. Keep local correction under user control and show upstream provenance rather than implying every database result is correct |

These are product documentation claims, not independent measurements of the competitors' entire databases. Dataset sizes and feature marketing were not used as proxies for accuracy.

## Source contracts and limits

**USDA:** Foundation, SR Legacy, FNDDS and Branded are different datasets. Branded food is industry-supplied label data, not equivalent to USDA laboratory measurement. SR Legacy is a historical release. TPS exposes the returned data type and publication date without representing publication as a laboratory sampling date. The existing newest-record-per-GTIN and complete-core duplicate guards remain. Search caches last five minutes. [USDA FAQ](https://fdc.nal.usda.gov/faq/), [branded documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/).

**Open Food Facts:** Normalized mass nutrients are grams, energy is kcal/kJ, alcohol is volume percentage; serving and prepared fields have distinct meanings. TPS reads as-sold normalized values, keeps explicit serving data, records mismatches, and never combines prepared and unprepared nutrition. A `_100g` field can mean per 100 ml for liquids: a label's metric serving is needed for confident volume handling. Without that evidence the existing per-100g fallback remains, and users must check the denominator. Search cache is ten minutes; barcode hits thirty minutes and confirmed misses five minutes. Provider warnings are surfaced when returned; absence of warnings is not approval. [OFF nutrient schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/).

**Saved notes:** The test-vault snapshot contained two eligible local food definitions, both with four core fields, one with a barcode, neither with a provenance receipt. Neither had blank core properties. This is only the test vault, not the user's production catalogue. Local definitions are user-owned, not automatically verified. Existing explicit zeroes cannot safely be distinguished from zeroes fabricated by older versions, so no historical rewrite or migration runs.

**Built-in catalogue:** 42 records, 25 branded, 40 with calories/protein/carbs/fat, none with extended nutrients or source evidence. Numeric values were retained rather than replaced with unverified guesses. The ambiguous “Instant ramen, prepared” record is now “Instant ramen, package estimate”; no cooking conversion is invented. See the full inventory below. `node scripts/audit-food-catalog.mjs` reproduces its counts and serving/coverage inventory from source.

**Coverage:** TPS tracks 46 nutrient fields, not the full breadth of all USDA/Cronometer nutrients. Search responses can be incomplete. Ambiguous vitamin forms and unsupported units remain unknown. No NCCDB licensing, proprietary catalogue copying, bulk database mirror, manufacturer-label verification, global human-review service, automatic source correction, or outbound submission was added. AI/OCR estimates still require review. Existing daily totals sum available numeric values; the new completeness indicator applies to search foods, not a retroactive completeness guarantee for historical daily totals.

## Persisted and UI contract

The only additive food property is optional `nutritionProvenance`, an import receipt (provider/record/dataset/dates/URL/warnings). It survives direct imports, custom templates, saved-note reload, and normal object snapshots. Subsequent manual edits can differ from the original source; a receipt does not certify the current note. Existing settings, commands, routes and defaults are retained. No startup note rewrite runs.

Search opens in the existing food logger. Matching saved notes appear first. Each result has one **Nutrition data details** disclosure, with a native summary, visible keyboard focus, wrapping source text and touch padding. Opening it does not add a food. Expanded state is transient. The settings map remains **Daily logging** (default), **Food & goals**, **Workouts**, **Note library**, **Integrations & advanced**.

## Validation

Focused deterministic tests cover ranking, local preservation in both dedupe orders, distinct local paths, external-source attribution, zero/unknown persistence, custom templates, strict numbers, kJ/salt/USDA mass units, ABV volume conversion, polyol/carbohydrate precedence, source dates/flags, implausible data and import-aware energy preservation. Existing provider, search-race, saved-food, recipe, extended-nutrient and settings coverage remains in the full suite. Live provider coverage is separate from deterministic correctness and cannot verify every label.

Final test/build/reload and desktop/mobile UI evidence is recorded in the 0.47.0 README and release notes. Production installation remains a user BRAT action.

## Full built-in inventory

Every row below is an **unverified estimate** with no recorded source evidence. Core coverage counts calories, protein, carbohydrate and fat; total coverage includes other recorded nutrient fields and is not an accuracy score.

| Food | Basis | Core fields | Tracked fields |
| --- | --- | --- | --- |
| Honeycrisp apple, large | 242 g | 4/4 | 7/46 |
| Apple, raw, with skin | 100 g | 4/4 | 7/46 |
| Banana, raw | 100 g | 4/4 | 7/46 |
| Egg, whole, cooked | 50 g | 4/4 | 5/46 |
| Chicken breast, cooked, skinless | 100 g | 4/4 | 5/46 |
| White rice, cooked | 100 g | 4/4 | 6/46 |
| Oats, dry | 100 g | 4/4 | 7/46 |
| Greek yogurt, plain, nonfat | 100 g | 4/4 | 6/46 |
| Milk, whole | 100 g | 4/4 | 6/46 |
| Mozzarella cheese, whole milk | 28 g | 4/4 | 5/46 |
| Mozzarella cheese, part skim | 28 g | 4/4 | 5/46 |
| Mozzarella string cheese | 28 g | 4/4 | 5/46 |
| Sliced deli ham lunchmeat | 56 g | 4/4 | 6/46 |
| Great Value Black Forest Ham Lunchmeat | 56 g | 4/4 | 6/46 |
| Great Value Shredded Hash Browns | 85 g | 4/4 | 4/46 |
| Kraft Original Macaroni & Cheese Dinner | 70 g | 4/4 | 7/46 |
| Hidden Valley Original Ranch Dressing | 30 g | 4/4 | 6/46 |
| Tyson White Meat Chicken Nuggets | 90 g | 4/4 | 7/46 |
| Pepperidge Farm Goldfish Cheddar Crackers | 30 g | 4/4 | 7/46 |
| Nature Valley Crunchy Oats 'n Honey Granola Bars | 42 g | 4/4 | 7/46 |
| Jolly Rancher Sugar Free Hard Candy | 16 g | 4/4 | 7/46 |
| Sara Lee Delightful White Bread | 45 g | 4/4 | 7/46 |
| Sara Lee Artesano White Bread | 38 g | 4/4 | 7/46 |
| Hawaiian sweet roll | 28 g | 4/4 | 7/46 |
| Light + Fit Greek Vanilla Yogurt Cup | 150 g | 4/4 | 6/46 |
| Light + Fit Greek Strawberry Yogurt Cup | 150 g | 4/4 | 6/46 |
| Great Value Light Greek Vanilla Yogurt Cup | 150 g | 4/4 | 6/46 |
| Halo Top Vanilla Bean Ice Cream | 85 g | 4/4 | 7/46 |
| Fairlife 2% Ultra-Filtered Milk | 240 ml | 4/4 | 6/46 |
| Fairlife Fat Free Ultra-Filtered Milk | 240 ml | 4/4 | 6/46 |
| Michelob Ultra Organic Seltzer Signature Collection | 355 ml | 4/4 | 8/46 |
| Quest Tortilla Style Protein Chips, Nacho Cheese | 32 g | 4/4 | 6/46 |
| Quest Tortilla Style Protein Chips, Loaded Taco | 32 g | 4/4 | 6/46 |
| Quest Tortilla Style Protein Chips, Chili Lime | 32 g | 4/4 | 6/46 |
| Wilde Protein Chips, Buffalo Style | 34 g | 4/4 | 5/46 |
| Barebells Cookies & Cream Protein Bar | 55 g | 4/4 | 7/46 |
| Barebells Salty Peanut Protein Bar | 55 g | 4/4 | 7/46 |
| Legendary Foods Protein Pastry, Brown Sugar Cinnamon | 61 g | 4/4 | 7/46 |
| Legendary Foods Protein Pastry, S'mores | 61 g | 4/4 | 7/46 |
| Instant ramen, package estimate | 85 g | 4/4 | 7/46 |
| Whiskey, 80 proof | 44 ml | 1/4 | 2/46 |
| Vodka, 80 proof | 44 ml | 1/4 | 2/46 |
