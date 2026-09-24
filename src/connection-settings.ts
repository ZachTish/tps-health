import { SecretComponent, Setting } from "obsidian";
import type TPSHealthPlugin from "./main";
import { DEFAULT_SETTINGS, USDA_API_KEY_SECRET_MAX } from "./types";
import { normalizeUsdaApiKeySecrets } from "./settings-normalization";

export class HealthConnectionSettings {
  private disposed = false;
  constructor(private plugin: TPSHealthPlugin, private parent: HTMLElement) {}
  dispose(): void { this.disposed = true; }
  render(): void { this.refresh(); }
  private refresh(selector?: string): void {
    if (this.disposed) return;
    const scrollTop = this.parent.scrollTop;
    this.parent.empty();
    this.renderProviderCredentials(this.parent);
    if (selector) this.parent.querySelector<HTMLElement>(selector)?.focus({preventScroll: true});
    this.parent.scrollTop = scrollTop;
  }
  private renderProviderCredentials(section: HTMLElement): void {
    new Setting(section)
      .setName("Open Food Facts User-Agent")
      .setDesc("Open Food Facts asks API clients to identify themselves.")
      .addText((text) => text
        .setValue(this.plugin.settings.openFoodFactsUserAgent)
        .onChange(async (value) => {
          this.plugin.settings.openFoodFactsUserAgent = value.trim() || DEFAULT_SETTINGS.openFoodFactsUserAgent;
          await this.plugin.saveSettings();
        }));

    section.createEl("p", {
      cls: "setting-item-description",
      text: "USDA credentials are tried in order only when a device secret is empty or USDA returns API_KEY_MISSING/API_KEY_INVALID. Disabled, unverified, unauthorized, generic 403, and HTTP 429 responses do not rotate; TPS Health surfaces the error or waits for Retry-After.",
    });

    for (const [index, reference] of this.plugin.settings.usdaApiKeySecrets.entries()) {
      const label = index === 0 ? "USDA API key — Primary" : `USDA API key — Fallback ${index}`;
      const setting = new Setting(section)
        .setName(label)
        .setDesc(index === 0
          ? "First populated device-local Obsidian secret used for FoodData Central."
          : "Used only after an earlier device secret is empty or receives API_KEY_MISSING/API_KEY_INVALID.")
        .addComponent((element) => {
          element.dataset.tpsHealthUsdaSecretIndex = String(index);
          return new SecretComponent(this.plugin.app, element)
            .setValue(reference)
            .onChange(async (value) => {
              const references = [...this.plugin.settings.usdaApiKeySecrets];
              references[index] = value;
              this.plugin.settings.usdaApiKeySecrets = normalizeUsdaApiKeySecrets(references);
              await this.plugin.saveSettings();

              const nextIndex = Math.min(index, Math.max(0, this.plugin.settings.usdaApiKeySecrets.length - 1));
              this.refresh(
                this.plugin.settings.usdaApiKeySecrets.length
                  ? this.usdaSecretFocusSelector(nextIndex)
                  : "[data-tps-health-usda-add] button",
              );
            });
        });

      if (index > 0) {
        setting.addExtraButton((button) => {
          button.extraSettingsEl.dataset.tpsHealthUsdaAction = "move-up";
          button
            .setIcon("arrow-up")
            .setTooltip("Move USDA key earlier")
            .onClick(async () => {
              const references = [...this.plugin.settings.usdaApiKeySecrets];
              [references[index - 1], references[index]] = [references[index], references[index - 1]];
              this.plugin.settings.usdaApiKeySecrets = references;
              await this.plugin.saveSettings();

              this.refresh(this.usdaSecretFocusSelector(index - 1));
            });
        });
      }

      if (index < this.plugin.settings.usdaApiKeySecrets.length - 1) {
        setting.addExtraButton((button) => {
          button.extraSettingsEl.dataset.tpsHealthUsdaAction = "move-down";
          button
            .setIcon("arrow-down")
            .setTooltip("Move USDA key later")
            .onClick(async () => {
              const references = [...this.plugin.settings.usdaApiKeySecrets];
              [references[index], references[index + 1]] = [references[index + 1], references[index]];
              this.plugin.settings.usdaApiKeySecrets = references;
              await this.plugin.saveSettings();

              this.refresh(this.usdaSecretFocusSelector(index + 1));
            });
        });
      }

      setting.addExtraButton((button) => {
        button.extraSettingsEl.dataset.tpsHealthUsdaAction = "remove";
        button
          .setIcon("trash")
          .setTooltip("Remove USDA key reference")
          .onClick(async () => {
            this.plugin.settings.usdaApiKeySecrets = this.plugin.settings.usdaApiKeySecrets.filter((_entry, entryIndex) => entryIndex !== index);
            await this.plugin.saveSettings();

            const remaining = this.plugin.settings.usdaApiKeySecrets.length;
            this.refresh(
              remaining
                ? this.usdaSecretFocusSelector(Math.min(index, remaining - 1))
                : "[data-tps-health-usda-add] button",
            );
          });
      });
    }

    if (this.plugin.settings.usdaApiKeySecrets.length < USDA_API_KEY_SECRET_MAX) {
      const addSetting = new Setting(section)
        .setName(this.plugin.settings.usdaApiKeySecrets.length ? "Add USDA fallback" : "Add USDA API key")
        .setDesc(`Up to ${USDA_API_KEY_SECRET_MAX} ordered SecretStorage references. If none contain a value, TPS Health uses DEMO_KEY.`)
        .addButton((button) => {
          button.buttonEl.dataset.tpsHealthUsdaAction = "add";
          button
            .setButtonText("Add secret")
            .onClick(() => {
              const index = this.plugin.settings.usdaApiKeySecrets.length;
              this.plugin.settings.usdaApiKeySecrets = [...this.plugin.settings.usdaApiKeySecrets, ""];

              this.refresh(this.usdaSecretFocusSelector(index));
            });
        });
      addSetting.settingEl.dataset.tpsHealthUsdaAdd = "true";
    }

  }

  private usdaSecretFocusSelector(index: number): string {
    return `[data-tps-health-usda-secret-index="${index}"] input`;
  }

}
