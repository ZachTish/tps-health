# TPS Health 0.47.3

The food logger now makes the selected logging day visible before you choose or log food. A compact banner shows the full weekday and date, including the year:

- **Sun — Logging today**
- **Moon — Logging a past day**, with an amber border
- **Calendar — Logging a future day**, with an accent border

The banner stays above the Search/Describe/Quick add controls and remains visible during tray review. The single-food logging screen uses the same indicator. Date-picker edits update it immediately; the single-food Now/selected-day buttons also synchronize the picker display. The indicator follows the effective consumed date, rather than relying on an old daily-note “is today” flag.

Local calendar comparisons handle time zones, midnight, year changes and daylight-saving transitions. Text and icons distinguish the states without relying on color; the status has polite/atomic accessibility announcements. Date labels follow the device locale. No settings keys, logging defaults, storage schema or commands changed. This is a backward-compatible clarity fix, released as a patch. Minimum Obsidian: **1.12.0**.

## Validation

- Full declared suite: **431 passed, zero failed, one skipped** (optional live USDA test without a test credential).
- TypeScript, separate final production-mode build, shared `target=test` deployment and named test-vault plugin reload passed. Final rebuild was byte-identical; all three runtime artifacts match the release files.
- Visually checked all three icons/day labels in the reloaded **Obsidian Plugin Test Vault**. At 388 px modal width, no horizontal overflow; the banner remained above the open review panel.
- Changing a tray from future to past updated the banner immediately. The single-food picker and Now button changed future → past → today and kept the input synchronized.
- Used an in-memory synthetic food. No food logs, notes or outbound provider requests were created. Temporary UI fixtures/overrides were removed, original pending settings restored, and runtime `data.json` remained byte-identical.

An idle menu spanning midnight refreshes its label on the next open/date-edit/tray-render interaction. Physical iPhone behavior remains user acceptance.

**Tested in the test vault and ready for the user's BRAT pull. Production was not inspected, deployed or reloaded.**

## Artifact SHA-256

```text
main.js       5a9f60e9bd29884312e89112aab3b6a5e3b3b40a5700b6bb3ba9002744bcc9da
manifest.json 849c9237aaaf56d2c75f847e7daff480d736289acdf50d7597f08aacd6ad2bae
styles.css    2ea5f468771641df1968b53c7157f7f047cc48f2f236c826a18e11e14657d4b8
```
