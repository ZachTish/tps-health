TPS Health 2.0.0 brings workout-library and logged-record identifiers into Note library and replaces fallback mappings with confirmed note migrations.

Changes
- Configure the frontmatter key and values for reusable workout plans and exercises. Creation, templates, saved layouts, search and updates honor those mappings.
- Configure food-entry, activity-entry and workout-session values directly in Note library. Their shared property key remains GCM-owned, with its current value and a settings handoff shown beside the controls.
- Food, workout-library and native Health record-field mapping changes use Apply → review affected notes → confirm. All affected Markdown notes, including archived notes, are updated before saving the mapping. Cancel writes nothing.
- Detect conflicting properties, ambiguous old identities, concurrent settings/GCM changes, new matching notes and moved/edited notes. Ordinary failures attempt guarded rollback and report anything they cannot restore. Finish active workouts before changing mappings.
- Remove old-default/saved-alias fallback from normal identity and native-field readers and from exported GCM property scopes. Fix food updates reintroducing hardcoded kind and workout hydration/mutation losing sets under custom session mappings.

Upgrade and compatibility
This is a major release because older aliases no longer identify records. If your vault previously used custom mappings or legacy tpsType identifiers, open Note library → Migrate previous mappings → Review existing notes, review the affected notes, and confirm. No vault notes migrate automatically on upgrade. Old alias metadata exists only as migration input and is cleared after confirmation. Settings schema is 8; minimum Obsidian remains 1.12.0. Existing imported GCM property definitions are not rewritten automatically; re-import their scopes after native kind changes. Legacy log import and workout timing-format compatibility are separate from identifier mappings.

Validation
457 tests passed, zero failed; one optional live USDA check skipped without its credential. The full suite, TypeScript and mandatory separate production build passed. The final artifacts deployed only to Obsidian Plugin Test Vault and TPS Health was explicitly reloaded.

Real settings QA verified cancellation, forward/reverse key/value migrations, native activity-field migration, restored focus and all five routes. The real Save workout layout action wrote the custom key/value using a temporary synthetic active-session getter. The final artifact repeated the migration/creation loop successfully. QA used a Health-only synthetic file enumeration; all original settings/app references/getters/window state were restored, and both fixture batches moved from Inbox directly to _archive. Phone-width settings QA at 375 px content width had no horizontal overflow with the desktop sidebar temporarily hidden. Physical iOS acceptance remains user testing. No outbound providers were called and production was not accessed.

Known limits
Obsidian reserializes frontmatter while retaining note bodies. A vault-wide migration is not crash-atomic. Concurrent edits can prevent rollback; failures identify the affected paths. Shared GCM record-key migrations belong to GCM. No fallback aliases remain active in Health.

Tested in the test vault and ready for the user's manual BRAT pull. Publishing this release does not install it in production.

SHA-256 (tested uploaded artifacts)
- `main.js`: `5ebc97332912475f3b33ff217c09b7b961b39c858aeb2b43546eafa0da82841f`
- `manifest.json`: `d5f148556f2f37581419464df13523ed3bf4abc1e2fbf7ecd927ac6bb9b0eacc`
- `styles.css`: `2741450fa261f77c8588fd0a355219b6e4a66f881ca58692c00d400003a373f5`
