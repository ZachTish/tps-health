import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const start = source.indexOf('  async saveEnergySettings(');
const end = source.indexOf('  async saveNutrientGoal(', start);
assert.ok(start >= 0 && end > start, 'extract the actual energy save owner');
const ownerMethod = source.slice(start, end);
const result = await build({
  stdin: {
    contents: `
      import { parseEnergySettings, dailyEnergyEstimate } from './energy-estimate';
      import { energyActivitySourceSignature, type EnergyActivitySettings } from './energy-activity';
      import { DEFAULT_SETTINGS, type EnergyEstimateMode } from './types';
      import { normalizeTPSHealthSettings, isFutureTPSHealthSettings } from './settings-normalization';
      const logger = { flow(...args) { globalThis.__energySaveLogs?.push(args); } };
      export class EnergyOwner {
        settings: any;
        settingsPersistenceBlockedByFutureSchema: boolean;
        counts = { saves:0, refreshes:0, appearances:0 };
        persisted: any = null;
        failSave = false;
        app = { workspace: { trigger: (event: string) => {
          if (event !== 'tps-health:appearance-changed') throw new Error('Unexpected event: '+event);
          this.counts.appearances++;
        } } };
        nativeRecordService = { refreshConfiguration: () => this.counts.refreshes++ };
        constructor(stored: any = {}) {
          this.settings = normalizeTPSHealthSettings({...DEFAULT_SETTINGS,...stored});
          this.settingsPersistenceBlockedByFutureSchema = isFutureTPSHealthSettings(this.settings);
        }
        async saveSettings() {
          this.counts.saves++;
          if (this.failSave) throw new Error('Synthetic settings persistence failure');
          this.settings = normalizeTPSHealthSettings(this.settings);
          this.persisted = JSON.parse(JSON.stringify(this.settings));
        }
        ${ownerMethod}
      }
      export { DEFAULT_SETTINGS };
    `,
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const { EnergyOwner, DEFAULT_SETTINGS } = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const sourceSettings = {
  energyActivityIdentificationMode:'property',
  energyActivityPropertyKey:'kind',
  energyActivityPropertyValue:'transaction/activity',
  energyActivityTag:'health/activity',
  energyActivityCaloriesPropertyKey:'activeCalories',
  energyActivityDatePropertyKey:'finishedOn',
};
const energyProfile = {
  energyBmrKcal:1200, energyActivityFactor:1.4, energyFixedTdeeKcal:1900,
  calorieGoal:2100, proteinGoalG:125, customPreference:{ untouched:true },
};
const snapshot = value => structuredClone(value);

test('actual legacy two-argument save uses the full current settings source without overwriting new values', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings});
  const unrelated = snapshot({calorieGoal:owner.settings.calorieGoal,proteinGoalG:owner.settings.proteinGoalG,customPreference:owner.settings.customPreference});
  await owner.saveEnergySettings('1600','1.5');
  assert.equal(owner.settings.energyBmrKcal,1600);
  assert.equal(owner.settings.energyActivityFactor,1.5);
  assert.equal(owner.settings.energyEstimateMode,'calculated');
  assert.equal(owner.settings.energyFixedTdeeKcal,1900);
  assert.deepEqual(owner.counts,{saves:1,refreshes:0,appearances:1});
  assert.deepEqual(owner.persisted,JSON.parse(JSON.stringify(owner.settings)));
  assert.deepEqual({calorieGoal:owner.settings.calorieGoal,proteinGoalG:owner.settings.proteinGoalG,customPreference:owner.settings.customPreference},unrelated);
});

test('actual calculated and fixed saves preserve inactive activity configuration with no discovery refresh', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings});
  await owner.saveEnergySettings('1600','1.5','fixed','2300');
  assert.equal(owner.settings.energyEstimateMode,'fixed');
  assert.equal(owner.settings.energyFixedTdeeKcal,2300);
  assert.equal(owner.settings.energyBmrKcal,1600);
  assert.equal(owner.settings.energyActivityFactor,1.5);
  await owner.saveEnergySettings('1700','1.6','calculated','');
  assert.equal(owner.settings.energyBmrKcal,1700);
  assert.equal(owner.settings.energyActivityFactor,1.6);
  assert.equal(owner.settings.energyFixedTdeeKcal,null);
  for (const [key,value] of Object.entries(sourceSettings)) assert.equal(owner.settings[key],value);
  assert.deepEqual(owner.counts,{saves:2,refreshes:0,appearances:2});
});

test('actual enabling save refreshes configuration once and subsequent BMR-only save does not rediscover notes', async () => {
  const owner = new EnergyOwner(energyProfile);
  await owner.saveEnergySettings('1600','invalid hidden factor','activity-notes','',sourceSettings);
  assert.equal(owner.settings.energyEstimateMode,'activity-notes');
  assert.equal(owner.settings.energyBmrKcal,1600);
  assert.equal(owner.settings.energyActivityCaloriesPropertyKey,'activeCalories');
  assert.deepEqual(owner.counts,{saves:1,refreshes:1,appearances:1});
  await owner.saveEnergySettings('1700','invalid hidden factor');
  assert.equal(owner.settings.energyBmrKcal,1700,'the default full-settings fifth argument cannot restore the prior BMR');
  assert.deepEqual(owner.counts,{saves:2,refreshes:1,appearances:2});
  assert.equal(owner.settings.calorieGoal,energyProfile.calorieGoal);
  assert.deepEqual(owner.settings.customPreference,energyProfile.customPreference);
});

test('actual active property, tag, calories and date selector changes each refresh exactly once', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings,energyEstimateMode:'activity-notes'});
  const updates = [
    {...sourceSettings,energyActivityPropertyValue:'movement'},
    {...sourceSettings,energyActivityIdentificationMode:'tag',energyActivityTag:'activity/workout'},
    {...sourceSettings,energyActivityIdentificationMode:'tag',energyActivityTag:'activity/running'},
    {...sourceSettings,energyActivityCaloriesPropertyKey:'burnedKcal'},
    {...sourceSettings,energyActivityDatePropertyKey:'completedDate'},
  ];
  for (const [index,configuration] of updates.entries()) {
    await owner.saveEnergySettings('1600','1.4','activity-notes','',configuration);
    assert.deepEqual(owner.counts,{saves:index+1,refreshes:index+1,appearances:index+1});
  }
  await owner.saveEnergySettings('1600','1.4');
  assert.deepEqual(owner.counts,{saves:6,refreshes:5,appearances:6},'unchanged active selector does not refresh');
});

test('actual deactivation clears the activity projection once while later fixed/calculated changes do not refresh', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings,energyEstimateMode:'activity-notes'});
  await owner.saveEnergySettings('1600','1.5','calculated','');
  assert.deepEqual(owner.counts,{saves:1,refreshes:1,appearances:1});
  await owner.saveEnergySettings('1600','1.5','fixed','2300');
  await owner.saveEnergySettings('1700','1.6','calculated','');
  assert.deepEqual(owner.counts,{saves:3,refreshes:1,appearances:3});
});

test('actual persistence failure restores every energy field and performs no refresh or appearance event', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings});
  const previous = snapshot(owner.settings);
  owner.failSave = true;
  await assert.rejects(owner.saveEnergySettings('1600','1.5','activity-notes','',{...sourceSettings,energyActivityDatePropertyKey:'completedDate'}),/Synthetic settings persistence failure/);
  assert.deepEqual(owner.settings,previous);
  assert.equal(owner.persisted,null);
  assert.deepEqual(owner.counts,{saves:1,refreshes:0,appearances:0});
});

test('actual post-save projection failure cannot roll back settings that have already persisted', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings});
  owner.nativeRecordService.refreshConfiguration = () => {
    owner.counts.refreshes++;
    throw new Error('Synthetic projection refresh failure');
  };
  await assert.rejects(owner.saveEnergySettings('1600','1.5','activity-notes','',sourceSettings),/Synthetic projection refresh failure/);
  assert.equal(owner.settings.energyBmrKcal,1600);
  assert.equal(owner.settings.energyActivityFactor,1.5);
  assert.equal(owner.settings.energyEstimateMode,'activity-notes');
  assert.deepEqual(JSON.parse(JSON.stringify(owner.settings)),owner.persisted,'live and persisted settings retain the same committed configuration');
  assert.deepEqual(owner.counts,{saves:1,refreshes:1,appearances:0});
  assert.equal(owner.settings.calorieGoal,energyProfile.calorieGoal);
});

test('actual validation failure never enters persistence or changes current settings', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings});
  const previous = snapshot(owner.settings);
  await assert.rejects(owner.saveEnergySettings('1600','1.4','activity-notes','',{...sourceSettings,energyActivityPropertyValue:''}),/identify activity notes/);
  assert.deepEqual(owner.settings,previous);
  assert.deepEqual(owner.counts,{saves:0,refreshes:0,appearances:0});
});

test('actual future-schema guard rejects energy changes before parsing, saving or configuration refresh', async () => {
  const owner = new EnergyOwner({...energyProfile,...sourceSettings,settingsVersion:DEFAULT_SETTINGS.settingsVersion+1});
  const previous = snapshot(owner.settings);
  await assert.rejects(owner.saveEnergySettings('1600','1.5','activity-notes','',sourceSettings),/Update Health before editing energy settings/);
  assert.deepEqual(owner.settings,previous);
  assert.deepEqual(owner.counts,{saves:0,refreshes:0,appearances:0});
});
