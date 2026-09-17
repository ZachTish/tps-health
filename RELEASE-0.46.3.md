# TPS Health 0.46.3

Food search now checks configured databases after a short typing pause, so entering a product name no longer silently stops at saved foods. Exact product names rank above broad curated variants. Enter/search still runs immediately; barcode numbers require explicit submission.

Describe adds estimates to the existing tray and opens review in the same logger. It preserves earlier selections and consumed time, retains failures for retry, and opens completed background trays expanded. Common written quantities such as “one banana and two eggs” are recognized as amounts.

Mobile cleanup removes excess search spacing, moves secondary actions into the scrolling list, keeps Describe tabs above its form, fixes squeezed remove/close icons, and gives serving selectors a full row on the narrowest screens. No settings or note migration. Minimum Obsidian: **1.12.0**.

Validation: **390 passed, 0 failed, 1 skipped** (optional live USDA test without a test credential). Focused regressions, full suite, TypeScript, separate final production build, test-vault deployment/reload, and desktop/mobile-emulation UI checks passed. Public Open Food Facts returned Michelob Ultra results; typing the query showed seven combined results without Enter. A deterministic AI fixture appended a described banana beside an existing tray item, and both survived close/reopen. Physical iPhone keyboard behavior and live AI-provider execution remain unverified. The original test tray was restored; no food logs or production changes were made.

This is a backward-compatible patch, tested in **Obsidian Plugin Test Vault** and ready for the user's BRAT pull. Publication does not install it in production.

## SHA-256

```text
26dcf16aa01b01d367fc9325101908d87edc0576b49ac8e624dcecd431e88986  main.js
741fe440a49a270af9f6e2ca2384492de9652566f45e36530972cac791c8cf8b  manifest.json
5f1f4a10053c5a22bbe658beedd7b6e3246ab529c8b46cf6046e48f0f4178361  styles.css
```
