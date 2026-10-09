import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({ stdin: { contents: 'export * from "./energy-activity"; export {DEFAULT_SETTINGS} from "./types";',
  resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { projectEnergyActivity, parseEnergyActivitySettings, energyActivitySourceSignature, DEFAULT_SETTINGS } =
  await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const settings = { ...DEFAULT_SETTINGS, energyEstimateMode: 'activity-notes', energyActivityPropertyKey: 'kind',
  energyActivityPropertyValue: 'transaction/activity', energyActivityDatePropertyKey: 'completedDate', energyActivityCaloriesPropertyKey: 'burn' };
const note = { kind: ['transaction/activity'], completedDate: '2026-10-09', burn: 300 };

test('arbitrary property/list notes project once without native identity and respect configured keys', () => {
  for (const kind of ['transaction/activity', ['transaction/activity', 'transaction/activity']])
    assert.deepEqual(projectEnergyActivity(settings, { ...note, kind }), { dateIso: '2026-10-09', caloriesBurned: 300 });
  assert.equal(projectEnergyActivity(settings, { ...note, kind: 'transaction/activity/other' }), null, 'property values match exactly');
  assert.deepEqual(projectEnergyActivity({ ...settings, energyActivityPropertyKey: 'category', energyActivityDatePropertyKey: 'when',
    energyActivityCaloriesPropertyKey: 'kcal' }, { CATEGORY: 'transaction/activity', when: '2026-10-08', kcal: '42.5' }),
  { dateIso: '2026-10-08', caloriesBurned: 42.5 });
  assert.equal(projectEnergyActivity(settings, { ...note, burn: undefined, caloriesBurned: 500 }), null, 'no fallback to an unrelated calorie field');
});

test('tag selection includes frontmatter and inline nested tags but excludes prefix collisions', () => {
  const tags = { ...settings, energyActivityIdentificationMode: 'tag', energyActivityTag: '#Activity' };
  for (const tag of ['activity', 'activity/walk', 'ACTIVITY/run']) {
    assert.deepEqual(projectEnergyActivity(tags, { ...note, tags: [tag] }), { dateIso: '2026-10-09', caloriesBurned: 300 });
    assert.deepEqual(projectEnergyActivity(tags, note, ['#' + tag]), { dateIso: '2026-10-09', caloriesBurned: 300 });
  }
  assert.equal(projectEnergyActivity(tags, note, ['#activities', '#activity-other']), null);
  assert.equal(projectEnergyActivity({ ...tags, energyActivityTag: '' }, note), null);
});

test('dates and measured calories are validated without guessing a date or converting unknown values to zero', () => {
  assert.deepEqual(projectEnergyActivity(settings, { ...note, burn: 0 }), { dateIso: '2026-10-09', caloriesBurned: 0 });
  for (const burn of [null, '', 'no', -1, Infinity, NaN, true, [30]]) assert.equal(projectEnergyActivity(settings, { ...note, burn }), null);
  for (const completedDate of ['', '2026-02-30', '2026-13-01', '2026-10-09garbage', new Date(NaN), null])
    assert.equal(projectEnergyActivity(settings, { ...note, completedDate }), null);
  assert.equal(projectEnergyActivity(settings, { ...note, completedDate: undefined, date: '2026-10-09' }), null);
  const time = '2026-10-09T23:15:00-05:00';
  const parsed = new Date(time);
  const dateIso = `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
  assert.equal(projectEnergyActivity(settings, { ...note, completedDate: time }).dateIso, dateIso, 'timestamps use local day');
  assert.equal(projectEnergyActivity(settings, { ...note, completedDate: '2024-02-29' }).dateIso, '2024-02-29');
});

test('configured archive fields are respected and ambiguous case variants are not guessed', () => {
  assert.equal(projectEnergyActivity({ ...settings, nativeRecordProperties: { ...DEFAULT_SETTINGS.nativeRecordProperties, archived: 'hidden' } },
    { ...note, hidden: true }), null);
  assert.ok(projectEnergyActivity(settings, { ...note, archived: false }));
  assert.equal(projectEnergyActivity(settings, { ...note, Burn: 600 }), null);
});

test('selector validation allows shared/read-only keys and retains inactive drafts', () => {
  const parsed = parseEnergyActivitySettings({ ...settings, energyActivityTag: '#activity', energyActivityPropertyKey: ' kind ' });
  assert.equal(parsed.energyActivityPropertyKey, 'kind');
  assert.equal(parsed.energyActivityTag, 'activity');
  const tag = parseEnergyActivitySettings({ ...parsed, energyActivityIdentificationMode: 'tag', energyActivityPropertyKey: '', energyActivityPropertyValue: '' });
  assert.equal(tag.energyActivityPropertyKey, '');
  for (const overrides of [{ energyActivityPropertyValue: '' }, { energyActivityPropertyKey: '' }, { energyActivityCaloriesPropertyKey: '' },
    { energyActivityDatePropertyKey: '' }, { energyActivityIdentificationMode: 'tag', energyActivityTag: 'activity other' }])
    assert.throws(() => parseEnergyActivitySettings({ ...parsed, ...overrides }));
  assert.equal(energyActivitySourceSignature({ ...settings, energyEstimateMode: 'fixed' }), '');
  assert.equal(energyActivitySourceSignature(settings), energyActivitySourceSignature({ ...settings, energyBmrKcal: 1800 }), 'BMR changes need no rediscovery');
  assert.notEqual(energyActivitySourceSignature(settings), energyActivitySourceSignature({ ...settings, energyActivityPropertyValue: 'other' }));
});
