import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/native-daily-dashboard.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadDateFilterModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/native-daily-date-filter.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { buildNativeDailyActivityModel, buildNativeDailyDashboardModel, formatNativeDailyMetricValue, parseNativeDailyDisplayOptions } = await loadModule();
const { resolveNativeDailyDateFilter } = await loadDateFilterModule();
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const totals = {
  dateIso: '2026-08-24', entryCount: 1, calories: 126, proteinG: 0.7, carbsG: 33.4,
  fatG: 0.5, fiberG: 5.8, sugarG: 25.2, sugarAlcoholG: 0,
  sugarAlcoholCaloriesPerG: 0, alcoholG: 0, sodiumMg: 2,
};

test('daily dashboard maps indexed nutrition to configured goal metrics', () => {
  const model = buildNativeDailyDashboardModel(totals, [
    { propertyKey: 'consumedCalories', label: 'Consumed calories', unit: 'kcal', kind: 'max', max: 2100 },
    { propertyKey: 'protein', label: 'Protein', unit: 'g', kind: 'min', min: 125 },
    { propertyKey: 'carbs', label: 'Carbs', unit: 'g', kind: 'range', min: 120, max: 260 },
    { propertyKey: 'activity', label: 'Activity', unit: 'min', kind: 'min', min: 45 },
  ], { dateIso: '2026-08-24', entryCount: 2, durationMinutes: 50, caloriesBurned: 320, steps: 6400 });
  assert.equal(model.entryCount, 1);
  assert.equal(model.calories, 126);
  assert.deepEqual(model.metrics.map((metric) => [metric.propertyKey, metric.value]), [
    ['consumedCalories', 126], ['protein', 0.7], ['carbs', 33.4],
  ]);
  assert.equal(model.metrics[0].targetLabel, 'up to 2100 kcal');
  assert.equal(model.metrics[1].state, 'below');
  assert.equal(model.metrics[2].targetLabel, '120–260 g');
  assert.equal(model.activity.entryCount, 2);
  assert.equal(model.activity.metrics[0].value, 50);
  assert.equal(model.activity.metrics[0].targetLabel, 'at least 45 min');
});

test('daily dashboard marks values beyond a maximum and clamps the progress bar', () => {
  const model = buildNativeDailyDashboardModel({ ...totals, calories: 2400 }, [
    { propertyKey: 'consumedCalories', label: 'Calories', unit: 'kcal', kind: 'max', max: 2100 },
  ]);
  assert.equal(model.metrics[0].state, 'above');
  assert.equal(model.metrics[0].progress, 1);
});

test('activity builds independently from nutrition totals', () => {
  const model = buildNativeDailyActivityModel(
    { dateIso: '2026-08-24', entryCount: 2, durationMinutes: 50, caloriesBurned: 320, steps: 6400 },
    [
      { propertyKey: 'protein', label: 'Protein', unit: 'g', kind: 'min', min: 125 },
      { propertyKey: 'activity', label: 'Activity', unit: 'min', kind: 'min', min: 45 },
    ],
  );
  assert.equal(model.entryCount, 2);
  assert.equal(model.durationMinutes, 50);
  assert.deepEqual(model.metrics.map((metric) => [metric.propertyKey, metric.value]), [['activity', 50]]);
});

test('daily dashboard formats whole and fractional values without noisy precision', () => {
  assert.equal(formatNativeDailyMetricValue(126), '126');
  assert.equal(formatNativeDailyMetricValue(0.70000001), '0.7');
  assert.equal(formatNativeDailyMetricValue(Number.NaN), '0');
});

test('macro display options preserve the table default and separate Bases-style date filters', () => {
  assert.deepEqual(parseNativeDailyDisplayOptions(''), {
    kind: 'valid', options: { macroStyle: 'table', foodList: 'hidden' }, filterSource: '',
  });
  assert.deepEqual(parseNativeDailyDisplayOptions(`
style: rings
foods: expanded
filters:
  and:
    - date(note.date) == today() - "1d"
`), {
    kind: 'valid',
    options: { macroStyle: 'rings', foodList: 'expanded' },
    filterSource: 'filters:\n  and:\n    - date(note.date) == today() - "1d"',
  });
  assert.deepEqual(parseNativeDailyDisplayOptions('style: rings\nfoods: true'), {
    kind: 'valid', options: { macroStyle: 'rings', foodList: 'collapsed' }, filterSource: '',
  });
  assert.equal(parseNativeDailyDisplayOptions('style: cards').kind, 'invalid');
  assert.equal(parseNativeDailyDisplayOptions('foods: maybe').kind, 'invalid');
  assert.equal(parseNativeDailyDisplayOptions('style: rings\nstyle: table').kind, 'invalid');
});

test('daily dashboard date filters use Bases equality, variables, functions, and duration syntax', () => {
  const context = {
    todayIso: '2026-08-30',
    fileName: 'Dashboard',
    filePath: 'Dashboards/Dashboard.md',
    properties: { scheduled: '2026-08-24 00:00:00', reviewDate: '2026-09-02' },
  };
  assert.deepEqual(resolveNativeDailyDateFilter('', context), { kind: 'empty' });
  assert.deepEqual(resolveNativeDailyDateFilter('date(note.date) == today()', context), {
    kind: 'resolved', dateIso: '2026-08-30', expression: 'date(note.date) == today()',
  });
  assert.equal(resolveNativeDailyDateFilter('date(note.date) == today() - "1d"', context).dateIso, '2026-08-29');
  assert.equal(resolveNativeDailyDateFilter('date(note.date) == date(this.scheduled)', context).dateIso, '2026-08-24');
  assert.equal(resolveNativeDailyDateFilter('date == date(this.file.properties.reviewDate)', context).dateIso, '2026-09-02');
  assert.equal(resolveNativeDailyDateFilter('date(note.date) == date("2026-09-05") + "1 week"', context).dateIso, '2026-09-12');
  assert.equal(resolveNativeDailyDateFilter('date(note.date) == date("2027-01-31") + "1M"', context).dateIso, '2027-02-28');
});

test('daily dashboard accepts a Bases filters wrapper and resolves embedding-file variables', () => {
  const context = {
    todayIso: '2026-08-30',
    fileName: 'Sun, Aug 30 2026',
    filePath: 'Daily/Sun, Aug 30 2026.md',
    fileDateIso: '2026-08-30',
    properties: {},
  };
  const result = resolveNativeDailyDateFilter(`filters:\n  and:\n    - date(note.date) == date(this.file.name)`, context);
  assert.equal(result.kind, 'resolved');
  assert.equal(result.dateIso, '2026-08-30');
});

test('daily dashboard date filters fail closed on missing, invalid, or ambiguous selectors', () => {
  const context = { todayIso: '2026-08-30', fileName: 'Dashboard', filePath: 'Dashboard.md', properties: {} };
  assert.equal(resolveNativeDailyDateFilter('note.kind == "food-entry"', context).kind, 'invalid');
  assert.equal(resolveNativeDailyDateFilter('date(note.date) == date(this.missing)', context).kind, 'invalid');
  assert.equal(resolveNativeDailyDateFilter('date(note.date) == date("2026-02-30")', context).kind, 'invalid');
  assert.equal(resolveNativeDailyDateFilter('date == today()\ndate == today() - "1d"', context).kind, 'invalid');
});

test('Health registers independently embeddable macro and activity renderers plus the compatibility renderer', () => {
  assert.match(mainSource, /registerNativeDailySection\("tps-health-macros", "macros"\)/u);
  assert.match(mainSource, /registerNativeDailySection\("tps-health-activity", "activity"\)/u);
  assert.match(mainSource, /registerNativeDailySection\("tps-health-daily", "combined"\)/u);
  assert.match(mainSource, /parseNativeDailyDisplayOptions\(source\)/u);
  assert.match(mainSource, /resolveNativeDailyDateFilter\(display\.filterSource/u);
  assert.match(mainSource, /new TPSHealthNativeDailyDashboardChild\(el, this, dateContext, section, display\.options\)/u);
  assert.match(mainSource, /getDailyFoodMacroTotals\(this\.dateContext\.dateIso\)/u);
  assert.match(mainSource, /if \(this\.section === "activity"\) \{[\s\S]*?renderNativeDailyActivity\([\s\S]*?return;[\s\S]*?getDailyFoodMacroTotals/u);
  assert.match(mainSource, /this\.section === "macros"[\s\S]*?\["food-entry"\][\s\S]*?this\.section === "activity"[\s\S]*?\["activity-entry", "workout-session"\]/u);
  assert.match(stylesSource, /\.tps-health-native-daily/u);
  assert.doesNotMatch(stylesSource, /(?:^|\n)\s*\.native-daily/u);
});

test('daily dashboard uses a compact Base-like table and accessible toolbar', () => {
  assert.match(mainSource, /setIcon\(headingIcon, "table-2"\)/u);
  assert.match(mainSource, /role: "toolbar", "aria-label": "Macro actions"/u);
  assert.match(mainSource, /role: "toolbar", "aria-label": "Activity actions"/u);
  assert.match(mainSource, /text: "Macros"/u);
  assert.match(mainSource, /text: "Activity"/u);
  assert.match(mainSource, /metrics\.setAttr\("role", "table"\)/u);
  assert.match(mainSource, /metricHeader\.createSpan\(\{ text: "Metric", attr: \{ role: "columnheader" \} \}\)/u);
  assert.match(stylesSource, /\.tps-health-native-daily\s*\{[\s\S]*?background:\s*var\(--background-primary\)[\s\S]*?border-radius:\s*var\(--radius-s\)[\s\S]*?overflow:\s*hidden/u);
  assert.match(stylesSource, /\.tps-health-native-daily-metric-header\s*,[\s\S]*?grid-template-columns:/u);
  assert.match(stylesSource, /\.tps-health-native-daily-action\s*\{[\s\S]*?background:\s*transparent[\s\S]*?width:\s*30px/u);
  assert.match(stylesSource, /\.tps-health-native-daily-host\s*\{[\s\S]*?display:\s*block/u);
  assert.match(stylesSource, /\.tps-health-native-daily-host\s*,[\s\S]*?max-width:\s*none[\s\S]*?width:\s*100%/u);
  assert.match(stylesSource, /\.is-phone \.tps-health-native-daily-host\s*\{[\s\S]*?transform:\s*var\(--bases-embed-transform, none\)[\s\S]*?width:\s*var\(--bases-embed-width, 100%\)/u);
  assert.match(stylesSource, /\.is-phone \.tps-health-native-daily\s*\{[\s\S]*?border-radius:\s*var\(--bases-embed-border-radius,[\s\S]*?border-width:\s*var\(--bases-embed-border-width,/u);
  assert.match(stylesSource, /\.tps-health-native-daily-stack\s*\{[\s\S]*?display:\s*grid[\s\S]*?gap:/u);
  assert.doesNotMatch(mainSource, /button\.createSpan\(\{ text: label \}\)/u);
});

test('macro dashboard supports accessible rings and an optional collapsible food contribution list', () => {
  assert.match(mainSource, /display\.macroStyle === "rings"/u);
  assert.match(mainSource, /aria-label": "Daily macro rings"/u);
  assert.match(mainSource, /--tps-health-native-ring-progress/u);
  assert.match(mainSource, /createEl\("details", \{ cls: "tps-health-native-daily-foods" \}\)/u);
  assert.match(mainSource, /details\.open = expanded/u);
  assert.match(mainSource, /aria-label": `Open food entry \$\{entry\.title\}`/u);
  assert.match(mainSource, /getDailyFoodEntries\(this\.dateContext\.dateIso\)/u);
  assert.match(stylesSource, /\.tps-health-native-daily-rings\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(96px, 1fr\)\)/u);
  assert.match(stylesSource, /\.tps-health-native-daily-ring\s*\{[\s\S]*?conic-gradient/u);
  assert.match(stylesSource, /\.tps-health-native-daily-food-row\s*\{[\s\S]*?grid-template-columns:/u);
  assert.match(stylesSource, /\.tps-health-native-daily \.tps-health-native-daily-food-title\s*\{[\s\S]*?background:\s*transparent[\s\S]*?box-shadow:\s*none[\s\S]*?text-align:\s*left/u);
  assert.match(stylesSource, /@container \(max-width: 360px\)[\s\S]*?\.tps-health-native-daily-rings\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/u);
  assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.tps-health-native-daily-foods-summary,[\s\S]*?min-height:\s*44px/u);
});

test('macro and activity dashboards expose compact edit and remove lists in both rendered modes', () => {
  assert.match(mainSource, /addAction\("Review logged foods", "list"/u);
  assert.match(mainSource, /addActivityAction\("Review logged activity", "list"/u);
  assert.match(mainSource, /getDailyActivityEntries\(this\.dateContext\.dateIso\)/u);
  assert.match(mainSource, /renderNativeDailyRowAction\(rowActions, `Edit \$\{entry\.title\}`, "pencil", \(\) => actions\.editFoodEntry\(entry\)\)/u);
  assert.match(mainSource, /renderNativeDailyRowAction\(rowActions, `Remove \$\{entry\.title\}`, "trash-2", \(\) => actions\.removeFoodEntry\(entry\), true\)/u);
  assert.match(mainSource, /entry\.kind === "workout-session" \? `Open \$\{entry\.title\}` : `Edit \$\{entry\.title\}`/u);
  assert.match(mainSource, /this\.openDiscardWorkoutConfirmation\(\)/u);
  assert.match(mainSource, /updateDailyFoodEntry\(this\.entry\.path/u);
  assert.match(mainSource, /updateDailyActivityEntry\(this\.entry\.path/u);
  assert.match(mainSource, /archiveDailyEntry\(entry\.path/u);
  assert.match(stylesSource, /\.tps-health-native-daily-row-actions\s*\{[\s\S]*?display:\s*flex[\s\S]*?grid-column:\s*3/u);
  assert.match(stylesSource, /\.tps-health-native-daily \.tps-health-native-daily-row-action\s*\{[\s\S]*?height:\s*28px[\s\S]*?width:\s*28px/u);
  assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.tps-health-native-daily \.tps-health-native-daily-row-action\s*\{[\s\S]*?min-height:\s*44px/u);
});

test('Daily Note actions use the exact resolved date context for every Health workflow', () => {
  assert.match(mainSource, /new TPSHealthNativeDailyDashboardChild\(el, this, dateContext, section, display\.options\)/u);
  assert.match(mainSource, /addFood:\s*\(\) => this\.plugin\.openFoodLogger\(\{ \.\.\.this\.dateContext \}\)/u);
  assert.match(mainSource, /logActivity:\s*\(\) => this\.plugin\.openActivityLogger\(\{ \.\.\.this\.dateContext \}\)/u);
  assert.match(mainSource, /startWorkout:\s*\(\) => this\.plugin\.openWorkoutStarter\(\{ \.\.\.this\.dateContext \}\)/u);
  assert.match(mainSource, /addAction\("Add food", "utensils", actions\.addFood\)/u);
  assert.match(mainSource, /addActivityAction\("Log activity", "activity", actions\.logActivity\)/u);
  assert.match(mainSource, /addActivityAction\("Start workout", "dumbbell", actions\.startWorkout\)/u);
  assert.match(mainSource, /const activeWorkout = this\.plugin\.getActiveNativeWorkoutPresentation\(\)/u);
  assert.match(mainSource, /if \(this\.section !== "macros"\) \{\s*this\.register\(this\.plugin\.onActiveWorkoutStateChanged\(scheduleRefresh\)\);\s*\}/u);
  assert.match(mainSource, /if \(actions\.activeWorkout\) \{[\s\S]*?text: activeWorkoutElapsedLabel\(actions\.activeWorkout\.startedAt\)[\s\S]*?text: "Resume"[\s\S]*?"aria-label": "Resume active workout"[\s\S]*?text: "Finish"[\s\S]*?"aria-label": "Finish active workout"[\s\S]*?\} else \{[\s\S]*?addActivityAction\("Start workout"/u);
  assert.match(mainSource, /this\.activeWorkoutTimer = window\.setInterval\(update, 1000\)/u);
  assert.match(mainSource, /if \(this\.activeWorkoutTimer != null\) window\.clearInterval\(this\.activeWorkoutTimer\)[\s\S]*?catch \(error\) \{[\s\S]*?this\.syncActiveWorkoutTimer\(null\)/u);
  assert.match(stylesSource, /\.tps-health-native-daily-actions\s*\{[^}]*display:\s*flex/u);
  assert.match(stylesSource, /\.tps-health-native-daily-active-workout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto auto auto/u);
  assert.match(stylesSource, /@container \(max-width: 360px\)[\s\S]*?\.tps-health-native-daily-active-workout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto auto/u);
  assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.tps-health-native-daily-action\s*,\s*\.tps-health-native-daily-active-workout-button\s*,[\s\S]*?\{[^}]*min-height:\s*44px/u);
  assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.tps-health-native-daily-action\s*\{[^}]*min-width:\s*44px/u);
});

test('dashboard refreshes from the indexed record signal instead of racing MetadataCache', () => {
  assert.match(mainSource, /nativeRecordService\?\.onRecordsChanged/u);
  assert.match(mainSource, /change\.dates\.includes\(this\.dateContext\.dateIso\)/u);
  assert.match(mainSource, /window\.setTimeout\(\(\) => \{[\s\S]*?this\.render\(\);[\s\S]*?\}, 0\)/u);
  assert.doesNotMatch(mainSource, /metadataCache\.on\("changed"[\s\S]{0,600}?scheduleRefresh/u);
});
