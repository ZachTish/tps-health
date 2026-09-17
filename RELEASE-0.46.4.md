# TPS Health 0.46.4

Follow-up verification found and fixed Describe races that were still present in 0.46.3:

- Closing and reopening during preparation now updates the visible tray automatically and opens review. Later additions and portion edits keep saving.
- Describe completion during a batch log preserves each existing entry so a successful log removes it once. A stale logger stops before further writes and shows the current tray.
- A failed tray save retains the prepared estimate for retry instead of running a second food-matching fallback. Successful edits, removals, clearing, and logging acknowledge recovery work so handled estimates do not reappear at startup.
- Generic-serving estimates now show the weight of one serving: two eggs are two 50 g servings, with the same 156 kcal total. Explicit gram/milliliter amounts retain their basis.

The settled database search and compact mobile layout from 0.46.3 remain included. No settings, command, or note migration; previously queued estimates are not rewritten. Minimum Obsidian: **1.12.0**. This is a backward-compatible patch.

Validation: **402 passed, 0 failed, 1 skipped** (optional live USDA test without a test key). Full declared tests, TypeScript, the separate final build, test-vault deployment/reload, and desktop/mobile-emulation UI checks passed. Public Open Food Facts returned seven combined Michelob Ultra results without Enter. Actual local Describe added banana/eggs at a measured 390 px width. A held synthetic AI response verified close/reopen completion, portion edits, and one-time consumption through an in-memory log fixture. The final egg serving label and quantity edit were rechecked through the UI. Original tray and desktop mode were restored; no consumption notes were written.

Physical iPhone keyboard behavior and live AI-provider execution remain unverified. Nutrition estimates require portion review; provider coverage and correctness are not guaranteed. Note writes and settings saves are not a single atomic filesystem transaction.

Tested in **Obsidian Plugin Test Vault** and ready for the user's BRAT pull. Production remains untouched. SHA-256 hashes follow below.


## SHA-256

```text
ce29557d8f9fb8fefe597e209c53aa36d1a1467380a7e223b0a8180c3ef6806d  main.js
a52aafead2ea1e38510d4b9696e56fe2d8942ac35731edbb6cca4f8074329c3d  manifest.json
5f1f4a10053c5a22bbe658beedd7b6e3246ab529c8b46cf6046e48f0f4178361  styles.css
```
