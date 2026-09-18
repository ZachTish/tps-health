# TPS Health 1.0.0 — Macros as a block

Removes the custom Macros Base layout, Open Macros Base command, Daily logging settings action, and unused Base model/toolbar/rendering/CSS code. Macros remains a `tps-health-macros` block, usable in Daily Notes or an ordinary Markdown dashboard page. No new dedicated workspace page is introduced.

The block retains rings/rows, recorded nutrients, optional goals, food and recipe contributions, date selection, and Add food. The existing Food Log and Activity Log record-list commands remain available.

## Upgrade notes

This is a major release because existing Macros Base configurations and command/hotkeys are intentionally retired. Existing `.base` files, embeds, food records, nutrition values and settings are preserved, not migrated or deleted. Replace a Macros Base embed with the block described in the README, or select another supported Base layout to retain a record-list view. The block displays one day; it does not replace native multi-day Base filtering. No settings schema or stored record changes. Minimum Obsidian: **1.12.0**, desktop and mobile.

## Validation

- 429 tests passed, zero failed; one optional live USDA test skipped without its test credential. Full declared suite and TypeScript build passed.
- Mandatory separate final production build reported test-vault deployment (byte-identical to the already inspected versioned runtime). Health was reloaded only in Obsidian Plugin Test Vault.
- Real settings showed retained block appearance controls and no Macros Base action. Runtime registry/commands confirmed removal.
- A synthetic Reading-mode block displayed macro rings and fiber, sodium, vitamin C and creatine. Automated coverage retains contribution expansion, styles, date selectors, nutrients and remaining commands. Physical iOS testing is not claimed.
- Temporary in-memory data overrides were restored; the fixture was archived from Inbox. Health data.json stayed byte-identical. No real food logs or provider calls were made during UI QA.

Tested in the isolated test vault and ready for the user's BRAT pull. Production installation has not been performed.

## SHA-256

- `main.js`: `eb4344f4081433b352069b936894973f8b555e63d55bed92125e905fb37d7b1f`
- `manifest.json`: `2c6ff342a4735ebbd9954aaf59cb837cbdcab116888730fa78963f91902cbc5a`
- `styles.css`: `cea435d375fb25eac49671f0d405279e04d3bb54ae5d90356c1f982d89f5cd14`
