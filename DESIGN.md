# TPS Health Design

TPS Health should behave like a health database that happens to be made of Markdown. The core rule is simple: daily notes are the log, library notes are reusable entities, and generated summaries are replaceable rollups.

## Product Principles

- Log first, organize second. Food and set entry needs to be fast enough to use while eating or training.
- Every reusable concept can become a note: food, recipe, meal, exercise, routine, workout, body metric, and eventually sleep.
- Imported data is never treated as final. Barcode/database values should be reviewable and locally correctable.
- Daily notes stay queryable. Logs should remain parseable single-line records with links to canonical notes when available.
- AI commands should call the API, not manipulate files directly.

## Research Takeaways

Food trackers converge on these workflows:

- Search, barcode, recent, favorite, quick-add macros, custom food, custom recipe, copy meal/day.
- Custom foods need label-aligned serving sizes, usually one serving plus grams/weight when available.
- Recipes need total ingredients, total yield, servings, and per-serving nutrition.
- Barcode misses should create a custom local food immediately, then log it.
- Good trackers separate "custom foods" from "custom recipes" and sometimes "custom meals" for repeated combinations.

Workout trackers converge on these workflows:

- Start empty workout or from routine template.
- Add exercise from library, create custom exercise if missing.
- Log sets with reps, weight, RPE/RIR, duration, distance, notes, and set type.
- Rest timers are per-exercise defaults with workout/session overrides.
- Supersets/circuits group exercises; dropsets/rest-pause/cluster sets group sets.
- Useful context while logging: previous values, PRs, volume, exercise notes, form cues.

## Obsidian Macros Plugin Takeaways

The community `macros` plugin by JamesCliffordSpratt has a mature nutrition implementation worth borrowing from:

- Search across multiple providers instead of depending on one database.
- Treat Open Food Facts as strongest for barcode/branded packaged foods, not generic ingredients.
- Use USDA Foundation/SR data first for generic foods.
- Normalize imported nutrition to a consistent basis, usually per 100g.
- Filter out Open Food Facts entries with no macro data.
- Barcode scanning should not depend on one live-video decode path. A more reliable Obsidian-mobile approach is:
  - request camera stream explicitly
  - draw video frames to canvas
  - try multiple ZXing decode methods
  - provide image upload/capture fallback
  - provide manual entry fallback
- Barcode lookups should try direct Open Food Facts product lookup first, then alternative barcode formats.

TPS Health now follows those patterns for the first pass of food search and barcode scanning.

## Canonical Notes

### Food

```yaml
---
tpsType: health-food
tpsHealthSchema: 1
name: "Greek Yogurt"
brand: "Example"
barcode: "012345678905"
servingAmount: 170
servingUnit: g
servings:
  - label: "1 container"
    amount: 170
    unit: g
  - label: "100 g"
    amount: 100
    unit: g
nutritionBasis:
  amount: 170
  unit: g
calories: 120
proteinG: 15
carbsG: 8
fatG: 2
---
```

Next implementation should support multiple serving aliases and a `nutritionBasis`. Current code has a single serving amount/unit, which is enough for logging but not enough for robust unit conversion.

### Recipe

```yaml
---
tpsType: health-recipe
tpsHealthSchema: 1
name: "Chicken Rice Bowl"
yieldAmount: 4
yieldUnit: serving
servings:
  - label: "1 bowl"
    amount: 1
    unit: serving
---
```

Recipe body should carry ingredient lines:

```md
- [tps-health:ingredient item="Health/Foods/Chicken breast.md" qty=600 unit="g"]
- [tps-health:ingredient item="Health/Foods/Rice cooked.md" qty=480 unit="g"]
```

Recipe rollup should calculate total nutrition, nutrition per serving, and optionally nutrition per gram when yield weight is known.

### Meal

A meal is a reusable combination that does not need recipe math. It is for repeated logging, like breakfast staples.

```yaml
---
tpsType: health-meal
name: "Workday breakfast"
---
```

```md
- [tps-health:meal-item item="Health/Foods/Greek Yogurt.md" qty=1 unit="container"]
- [tps-health:meal-item item="Health/Foods/Blueberries.md" qty=80 unit="g"]
```

### Exercise

```yaml
---
tpsType: health-exercise
tpsHealthSchema: 1
name: "Bench press"
category: strength
primaryMuscles: ["chest"]
secondaryMuscles: ["triceps", "front delts"]
equipment: ["barbell", "bench"]
defaultRestSeconds: 180
defaultSetType: normal
---
```

The current implementation creates this note automatically when a set references an unknown exercise.

### Routine

```yaml
---
tpsType: health-routine
name: "Push day"
---
```

```md
- [tps-health:routine-exercise item="Health/Exercises/Bench press.md" sets=3 reps="6-8" restSeconds=180 group=push-a]
- [tps-health:routine-exercise item="Health/Exercises/Incline dumbbell press.md" sets=3 reps="8-10" restSeconds=150]
```

Routine start should create a workout note populated with planned exercise blocks.

## Logging Flows

### Food Search

1. User searches.
2. Results show local verified foods first, then recipes/meals, then external databases.
3. Selecting external food asks whether to create local note.
4. User chooses serving alias, quantity, meal bucket, and note.
5. Daily note receives a single-line food log.
6. Automatic rollup updates totals.

### Barcode

1. Scan or manually enter barcode.
2. If barcode matches local note, use that note.
3. Else fetch Open Food Facts.
4. Review product fields.
5. Create local note, or log once without saving.
6. Choose serving and quantity.
7. Log and roll up.

### Quick Add

For meals where accuracy is intentionally approximate:

```ts
await app.tpsHealth.logFood({
  item: {
    id: "quick",
    name: "Restaurant estimate",
    source: "manual",
    nutrition: { calories: 850, proteinG: 35, carbsG: 90, fatG: 35 }
  },
  quantity: 1,
  unit: "entry",
  meal: "dinner"
});
```

### Recipe Builder

1. Create recipe shell.
2. Add ingredients from search/barcode/manual.
3. Normalize ingredient quantities against each food's serving basis.
4. Enter yield: servings and optional cooked weight.
5. Save recipe nutrition rollup.
6. Recipe becomes searchable and loggable as a food.

### Workout

1. Start empty workout or routine.
2. Add exercise. If missing, create exercise note.
3. Log set.
4. Timer starts according to settings and exercise override.
5. Dropsets link set records with `dropSet`.
6. Supersets/circuits link exercise blocks with `supersetGroup`.
7. Finish workout.
8. Workout summary remains linked from daily note.

## Near-Term Implementation Order

1. Replace single serving fields with serving aliases and nutrition basis.
2. Build recipe ingredient lines and recipe rollup.
3. Add recent/favorite foods and copy meal/day.
4. Add exercise search modal and exercise review modal.
5. Add routine notes and start-workout-from-routine.
6. Add previous-set lookup and PR/volume rollups.
7. Add AI parsing commands that convert natural language into API calls.
