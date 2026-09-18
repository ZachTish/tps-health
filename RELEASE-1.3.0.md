# TPS Health 1.3.0

Estimate full-day calorie expenditure and compare it with logged food in a comprehensive Health block.

Set **Health → Food & goals → Energy estimate**: enter BMR in kcal/day and a daily activity factor, then save. BMR is blank by default; clearing it disables the estimate. The factor defaults to 1.4 and is editable. TDEE is **BMR × activity factor**. This follows the [FAO/WHO/UNU PAL definition](https://www.fao.org/4/y5686e/y5686e04.htm); [NIDDK](https://www.niddk.nih.gov/bwp) describes typical factors of 1.4–2.5. Typical exercise is already included, so recorded workout/activity calories are not added twice.

Use this on a dashboard note:

```tps-health-overview
date == today()
```

In a Daily Note, omit the date filter to use that note's date. The block shows estimated daily burn, logged intake and the difference, followed by macros, nutrients and activity/workout controls. It supports the existing style/foods/nutrients options and validated single-date filters. Existing blocks retain their behavior.

An empty day says **No food logged**, instead of displaying a fabricated deficit. Display rounding does not change stored precision. Intake goals remain independent. All estimates use the current BMR/factor, including historical/future dates; dated profiles and day-specific overrides are not included. This is a habitual full-day estimate, not measured burn so far. Incomplete logging affects the comparison. Native Markdown record storage is required, as with existing daily blocks; no GCM property definitions are added.

This is a backward-compatible **minor feature release**, requiring Obsidian **1.12.0+**. New optional settings: energyBmrKcal (null) and energyActivityFactor (1.4). No existing goals, food/activity records, or navigation state are migrated. Invalid/nonfinite inputs are rejected; save failures restore the prior profile.

**Validation:** 444 tests passed, zero failed, one optional live USDA test skipped without a test credential. Full suite, TypeScript and separate final production build passed. Deployed/reloaded only **Obsidian Plugin Test Vault**. Real settings UI saved 1600 × 1.5, rejected an invalid factor, and preserved the profile after reload. A synthetic overview displayed 2400 kcal burn, 2000 kcal intake and 400 kcal below estimate, without adding 900 logged activity kcal. Verified empty-day, live profile update, equal-balance and disabled-BMR states, all five settings routes, save focus and a 388 px stacked layout without overflow. All temporary methods/profile values were restored; the QA note was archived. No consumption records, GCM changes, outbound provider calls or production access. Physical iOS acceptance remains user testing.

Tested in the test vault and ready for the user's **BRAT pull**; not installed in production.

## SHA-256 of tested artifacts

| Artifact | SHA-256 |
| --- | --- |
| main.js | 79e1e45c7c8e78eb93bb25dd4f788e9c1eee6f74a940e4221e246bb5ac88a65a |
| manifest.json | 96a6ea125ca66c90cad705ce4cd7e3b35e05b85b8abb951354dc9dd8f5924131 |
| styles.css | 8ee61cb53ee3968ce98b8f9293b69900e0f096ea3a92b0d3910027de5d5b996a |
