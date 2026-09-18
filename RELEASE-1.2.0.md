# TPS Health 1.2.0

Food & goals now has a searchable, categorized nutrient target editor with 98 built-in nutrients and compounds, plus your own definitions. Choose a nutrient and save a minimum, maximum, range or tracking-only goal without editing JSON or configuring GCM property menus.

- Adds 52 presets across amino acids, fat subtypes, carbohydrate fractions, vitamin forms, water and fluoride.
- Keeps all existing nutrients and arbitrary custom definitions. Custom definitions become available in the target picker immediately, including archived definitions for existing data.
- Saves and removes targets through direct controls; removing a goal retains food amounts. Invalid ranges and save failures retain prior targets.
- Preserves existing goal keys, labels, colors and ordering. Calorie maximum and protein minimum still update their canonical settings; activity and advanced JSON remain available.
- Extends exact-label USDA imports with explicit mass units. Missing nutrients remain unknown, known zero stays known, and subcomponents never add an extra parent macro/calorie contribution.

The interface follows [Cronometer's categorized nutrient-target editor](https://support.cronometer.com/hc/en-us/articles/360020571571-Mobile-Edit-Nutrient-Targets). Targets in Health remain user-defined; this does not add demographic DRI recommendations, automatic targets or nutrition scores. Provider coverage varies: EPA/DHA/ALA, omega-6 and some uncommon fields need manual known amounts, and saved foods are not automatically backfilled.

This is a backward-compatible feature release. Minimum Obsidian: **1.12.0**. Existing settings/defaults remain, with no new persisted navigation state or data migration. New built-ins use the existing Health storage mapping normalizer. All devices logging these new nutrients should update to 1.2.0.

Validation: **439 tests passed, 0 failed, 1 optional live USDA test skipped** without a test credential. TypeScript and separate final production build passed. Deployed only shipped artifacts to **Obsidian Plugin Test Vault**, reloaded Health and inspected all five settings destinations. Actual UI tests saved a 2–4 g leucine range, rejected a reversed range, retained the saved range after reload, added/searched a custom nutrient, saved its target and removed it. At 388 px the target editor stacked without horizontal overflow; save restored selector focus. Synthetic definitions/targets were restored. No consumption notes, GCM changes, provider calls or production access. Physical iOS acceptance remains user device testing.

Tested in the test vault and ready for the user's **BRAT pull**. This release is not a production installation.

## SHA-256 of tested release artifacts

| Artifact | SHA-256 |
| --- | --- |
| main.js | 3d204c87256e180e5c988fa2983dbf7b778b5f815c6853d15b35716eaa8b7ac9 |
| manifest.json | e30a5517b21b0ea4150e5b4c2151ded712e32e268d9e0c0ac2286bead84a14d5 |
| styles.css | 1b0e1bb4c5c53b41c632755090357aaccf4c343608aa34104f3dd6ef79f1691e |
