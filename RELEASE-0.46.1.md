# TPS Health 0.46.1

Fix food logger servings that disagreed with edits to the food note. This is a backward-compatible patch release.

- Explicit gram or milliliter serving amounts now take precedence over stale imported metric conversions and an incompatible per-100 basis. A note edited to 355 g displays **serving (355 g)**, and 177.5 g calculates half its entered nutrition.
- Apply the same serving denominator to atomic note projections. Preserve authored nutrient values; do not guess or rescale product nutrition. Coherent per-100 foods and household weight mappings retain their behavior.
- Saving edited foods removes obsolete gram/milliliter/basis fields from frontmatter and returned food data. Refresh persistent tray items when only their serving basis changes.
- Bound the optional live Open Food Facts test to 15 seconds so a provider outage cannot hang validation.

## Validation and BRAT handoff

379 automated tests passed; zero failures. One optional live USDA test was skipped because no test API key is configured. The full declared suite, TypeScript check, separate final production-mode build, test-vault deployment/reload, and byte-for-byte runtime artifact comparison passed.

In Obsidian Plugin Test Vault, reproduced the old per-100 dropdown with a synthetic 355 g note, verified the corrected dropdown and 177.5 g half-serving calculation, and saved a 355 ml edit through Update linked instances. Verified obsolete gram metadata was removed. Original tray state was restored; the fixture was archived. Physical mobile testing was not performed; no layout/settings changes or minimum-version change are included.

Minimum Obsidian: **1.12.0**. Ready for the user's BRAT pull; not installed in production. Reading food definitions reconciles metadata in memory, not through a bulk rewrite. Historical atomic-line snapshots remain unchanged. This fixes the serving definition, not the accuracy of provider-supplied nutrient amounts.

## SHA-256

```
bfe01628b587b86217ab92d757b10df9f27cb9e63ffa8ef095364b8add5b2fe3  main.js
b1177f290dc7d92232525421708ae643747e8bee761a6a4bb407c29abe3cbc7d  manifest.json
ff2d6bec18e9896c3d5f82a07a33d26500b0844b0fa79bc83478945cc306817a  styles.css
```
