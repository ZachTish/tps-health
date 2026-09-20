import { App, Modal, Notice, Setting, TFile, getFrontMatterInfo, parseYaml } from 'obsidian';
import type TPSHealthPlugin from './main';
import type { TPSHealthSettings } from './types';
import { HEALTH_MAPPING_KEYS, mappingSnapshot, migrateHealthFrontmatter } from './health-mapping';
import * as logger from './logger';

type Change = { file: TFile; before: Record<string, unknown>; after: Record<string, unknown> };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function readFrontmatter(app: App, file: TFile, identityKeys: string[]): Promise<Record<string, unknown>> {
  const info = getFrontMatterInfo(await app.vault.read(file));
  try {
    const value = (info.exists ? parseYaml(info.frontmatter) : {}) ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a property map.');
    return value;
  } catch {
    // An unrelated malformed note must not prevent a Health mapping change.
    // Be conservative for possible identities, escaped keys, anchors or aliases.
    const source = info.frontmatter || '';
    if (!identityKeys.some(key => source.toLowerCase().includes(key.toLowerCase())) && !/[\\&*!]|<</.test(source)) return {};
    throw new Error(`Repair invalid frontmatter before changing Health mappings: ${file.path}`);
  }
}

class ConfirmMappingMigration extends Modal {
  private accepted = false;
  constructor(app: App, private label: string, private changes: Change[], private resolve: (value: boolean) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Update existing Health notes?');
    this.contentEl.createEl('p', { text: this.label });
    this.contentEl.createEl('p', { text: `${this.changes.length} existing notes will be updated, including archived notes. Old keys and values will be removed. No fallback aliases will be kept.` });
    const list = this.contentEl.createEl('ul', { cls: 'tps-health-mapping-preview' });
    for (const change of this.changes) list.createEl('li', { text: change.file.path });
    this.contentEl.createEl('p', { text: 'Cancel keeps your current mapping and notes unchanged.' });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Update notes and mapping').setCta().onClick(() => { this.accepted = true; this.close(); }));
  }
  onClose(): void { this.resolve(this.accepted); this.contentEl.empty(); }
}

const busy = new WeakSet<TPSHealthPlugin>();
export async function changeHealthMapping(plugin: TPSHealthPlugin, next: TPSHealthSettings, label: string): Promise<boolean> {
  if (busy.has(plugin)) throw new Error('Another Health mapping change is already open.');
  busy.add(plugin);
  const before = structuredClone(plugin.settings);
  const changes: Change[] = [];
  const applied: Change[] = [];
  let settingsAttempted = false;
  try {
    await plugin.assertHealthMappingWritable(before);
    const api = plugin.getGcmNativeRecordsApi();
    const profile = api?.getStorageProfile?.();
    const kindKey = profile ? profile.kindPropertyKey : 'kind';
    const identityKeys = [before.foodFrontmatterKey, before.workoutFrontmatterKey, kindKey, 'kind', 'tpsType', 'runKind', 'runType', 'tpsId', 'tpsSchemaVersion', 'tags'].filter(Boolean);
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      const fm = await readFrontmatter(plugin.app, file, identityKeys);
      const inspected = api?.inspect?.(fm);
      // Never reinterpret an uninspectable native record as a reusable definition.
      if (!inspected && (fm.tpsSchemaVersion != null || fm.tpsId != null) && !api?.inspect) {
        throw new Error('Enable TPS GCM before migrating native Health records.');
      }
      if (inspected && !kindKey) throw new Error('Configure a shared record kind property in GCM before migrating Health mappings.');
      let updated: Record<string, unknown>;
      try { updated = migrateHealthFrontmatter(fm, before, next, inspected ? { kind: inspected.kind, kindKey } : null); }
      catch (error) { throw new Error(`${file.path}: ${error instanceof Error ? error.message : error}`); }
      if (!same(fm, updated)) changes.push({ file, before: fm, after: updated });
    }
    logger.flow('Settings', 'mapping:preview', { notes: changes.length });
    const confirmed = await new Promise<boolean>(resolve => new ConfirmMappingMigration(plugin.app, label, changes, resolve).open());
    if (!confirmed) return false;
    await plugin.assertHealthMappingWritable(before);
    if (!same(api?.getStorageProfile?.(), profile)) throw new Error('GCM record keys changed. Review the change again.');
    if (mappingSnapshot(plugin.settings) !== mappingSnapshot(before)) throw new Error('Mappings changed while the preview was open. Review the change again.');
    // Re-scan the whole vault: newly created matches also require a fresh preview.
    const currentFiles = plugin.app.vault.getMarkdownFiles();
    const planned = new Map(changes.map(change => [change.file.path, change]));
    for (const file of currentFiles) {
      const fm = await readFrontmatter(plugin.app, file, identityKeys);
      const inspected = api?.inspect?.(fm);
      const updated = migrateHealthFrontmatter(fm, before, next, inspected ? { kind: inspected.kind, kindKey } : null);
      const expected = planned.get(file.path);
      if (expected ? !same(fm, expected.before) || !same(updated, expected.after) : !same(fm, updated)) throw new Error('Notes changed while the preview was open. Review the change again.');
      planned.delete(file.path);
    }
    if (planned.size) throw new Error('A previewed note moved or was deleted. Review the change again.');
    for (const change of changes) {
      await plugin.app.fileManager.processFrontMatter(change.file, fm => {
        if (!same(fm, change.before)) throw new Error(`Note changed during migration: ${change.file.path}`);
        for (const key of Object.keys(fm)) delete fm[key];
        Object.assign(fm, change.after);
      });
      applied.push(change);
    }
    // Logging, sync or another editor can run while a large batch is writing.
    // Do not switch readers until every matching note still has the reviewed result.
    const completed = new Map(changes.map(change => [change.file.path, change]));
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      const fm = await readFrontmatter(plugin.app, file, identityKeys);
      const expected = completed.get(file.path);
      if (expected) {
        if (!same(fm, expected.after)) throw new Error('Notes changed during migration. Review the change again.');
      } else {
        const inspected = api?.inspect?.(fm);
        const updated = migrateHealthFrontmatter(fm, before, next, inspected ? { kind: inspected.kind, kindKey } : null);
        if (!same(fm, updated)) throw new Error('Notes changed during migration. Review the change again.');
      }
      completed.delete(file.path);
    }
    if (completed.size) throw new Error('A note moved during migration. Review the change again.');
    await plugin.assertHealthMappingWritable(before);
    if (mappingSnapshot(plugin.settings) !== mappingSnapshot(before) || !same(api?.getStorageProfile?.(), profile)) throw new Error('Mappings changed during migration. Review the change again.');
    for (const key of HEALTH_MAPPING_KEYS) (plugin.settings as any)[key] = structuredClone(next[key]);
    plugin.settings.nativeRecordKindAliases = {};
    plugin.settings.nativeRecordPropertyAliases = {};
    settingsAttempted = true;
    await plugin.saveSettings();
    await plugin.assertHealthMappingWritable(plugin.settings);
    plugin.nativeRecordService?.refreshConfiguration();
    logger.flow('Settings', 'mapping:complete', { notes: changes.length });
    new Notice(`Updated ${changes.length} Health notes and saved the mapping.`);
    return true;
  } catch (error) {
    const failed: string[] = [];
    for (const change of applied.reverse()) {
      try {
        await plugin.app.fileManager.processFrontMatter(change.file, fm => {
          if (!same(fm, change.after)) throw new Error('Concurrent edit');
          for (const key of Object.keys(fm)) delete fm[key];
          Object.assign(fm, change.before);
        });
      } catch { failed.push(change.file.path); }
    }
    if (settingsAttempted) {
      for (const key of HEALTH_MAPPING_KEYS) (plugin.settings as any)[key] = structuredClone(before[key]);
      try { await plugin.saveSettings(); } catch { failed.push('Health settings'); }
    }
    plugin.nativeRecordService?.refreshConfiguration();
    logger.flowError('Settings', 'mapping:failed', error, { changed: applied.length, rollbackFailures: failed.length });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${failed.length ? ` Could not restore: ${failed.join(', ')}. Keep the vault open and repair these before changing mappings again.` : ' No mapping change was saved; completed note changes were restored.'}`);
  } finally { busy.delete(plugin); }
}
