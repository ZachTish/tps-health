# TPS Health 1.1.0

Health can now track user-defined nutrients and additive measurements. The examples discussed previously are no longer the limit of what can be recorded.

In **Health → Food & goals → Custom nutrients**, enter a name and unit and click **Add nutrient**. Enter the amount per labeled serving in the food editor’s **Vitamins, minerals & custom nutrients** disclosure. Food portions, recipes, atomic logs, daily totals, nutrition details and inline macro contribution rows use the same definition. No GCM property-menu field or Health goal is required.

- Definitions and stable generated keys belong to Health. Standard nutrients remain available with their existing provider conversions.
- Rename a definition without changing stored amounts. Archive it to hide it from blank food editors while preserving recorded totals and editing of existing foods.
- Units stay fixed to protect historical meaning. Create a separate definition for a different unit. Custom amounts are nonnegative additive quantities; Health does not guess unit conversions or calorie contributions.
- Unknown values stay absent; known zero stays known. Existing display rounding does not change saved precision.
- Settings gain only the optional `customNutrients` array, empty by default. Existing settings destinations/default route, note fields, GCM menu configuration and provider credentials remain unchanged.
- Builds on published 1.0.0 and retains the inline-only macro block. The retired Macros Base is not reintroduced.

This is a backward-compatible feature release relative to 1.0.0. Minimum Obsidian remains **1.12.0**. Atomic note logging still uses GCM’s native-record bridge. Sync/backup Health settings with the notes so other devices retain custom labels and units; use 1.1.0+ when logging custom amounts. Provider data does not automatically gain user-defined fields: enter known label amounts manually.

## Validation

- Full declared suite: **433 passed, zero failed, one skipped** (optional live USDA test without a test credential).
- Tests cover arbitrary names and units registered after module loading, settings persistence, food save/reload, serving and recipe scaling, native projections, atomic lines, contribution totals, clearing amounts, archive, immutable units and failed-save recovery. GCM catalogs remain unchanged.
- TypeScript, separate final production build and shared `target=test` deployment passed. Reloaded TPS Health in the named **Obsidian Plugin Test Vault**; final byte-identical artifacts match that runtime.
- Used real settings controls to add a synthetic nutrient, then saved 120 mg per two capsules in the food editor. An inline macro block with an in-memory one-capsule snapshot displayed 60 mg and its contribution. Renaming/archiving preserved the amount; reloading retained the definition and editable 120 mg field.
- At 388 px settings width, the new controls stacked without horizontal overflow. Original definitions and temporary method overrides were restored; synthetic notes were moved directly from Inbox to `_archive/Health Custom Nutrients QA 1.1.0`. All temporary modals closed. No provider calls or production deployment were performed.

Tested in the test vault and ready for the user's BRAT pull. Physical iOS testing and production installation remain user-owned.

## SHA-256

| Artifact | SHA-256 |
| --- | --- |
| main.js | `a2b5b05ba2062b01b9d450af7823be9aafb128491f2f052da20cb3a0b6b3a3fd` |
| manifest.json | `c45987075546b5935810bffe63807d36f2daea54af0117ac7906ed6b7a48a284` |
| styles.css | `cea435d375fb25eac49671f0d405279e04d3bb54ae5d90356c1f982d89f5cd14` |
