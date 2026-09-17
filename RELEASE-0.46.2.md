# TPS Health 0.46.2

Food/meal data-integrity fixes and a small cleanup of obsolete scanner code. Backward-compatible patch; no settings migration.

- Preserve a queued food's entered quantity and unit when its definition changes. Do not turn 177.5 g into 177.5 servings. Show a correction message and keep the tray until the user selects a supported unit.
- Reject unsupported units and zero, negative, or nonfinite logging amounts before creating consumption records. Batch preflight prevents invalid selections from being written; recipe ingredients also validate conversions.
- Honor labeled household servings before generic volume conversions. A food defined as one cup weighing 170 g now contributes half its nutrients for half a cup, matching atomic note projections.
- Consolidate tray nutrition/error rendering across edits and refreshes. Remove unreachable Apple Shortcut launcher, URL, and visibility helpers; retain the existing inbox compatibility reader.

## Validation

383 Health tests passed; zero failures. One optional live USDA test skipped because no test key is configured. Full declared suite, TypeScript check, separate final production build, test-vault deployment/reload, and byte-for-byte artifact comparison passed.

UI smoke in Obsidian Plugin Test Vault reproduced the stale-unit inflation in 0.46.1, then verified that 0.46.2 retained the original g unit and created no log. Explicitly choosing ml changed the preview to 50 kcal / 12.5 g carbs; pressing Log produced an atomic food-entry note with those exact values. Original test tray and root settings were restored; synthetic notes archived.

Adjacent automated checks passed without changing those plugins: Calendar 59, GCM 104, Linter 276, Navigator 125, Controller 150. Three pre-existing Controller comparison tests were skipped. These are targeted automated checks, not a complete UI or external-service certification.

Minimum Obsidian **1.12.0**. Ready for the user's BRAT pull; not installed in production. No physical iPhone/iPad, real notification delivery, live finance/AI requests, or outbound calendar sync was exercised. Existing stored logs are not bulk rewritten.

## Cleanup candidates

Flagged for separate compatibility/removal decisions: retired Home action API, remaining Shortcut inbox integration, and parallel legacy atomic-line writers. This patch does not remove those contracts or the requested Macros Base. Migration and read/export compatibility need an explicit retirement plan.

## SHA-256

```
44743bd29a1aeaf69eacadd60bf9b9fb8da23196f8260c95e4bfd3e01b23ea72  main.js
94fc9d59bd0829ce422865a06204bf39a2fb609a778eb828d496b630bd56af26  manifest.json
ff2d6bec18e9896c3d5f82a07a33d26500b0844b0fa79bc83478945cc306817a  styles.css
```
