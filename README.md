# TPS Health

Food, recipes, nutrition dashboards, activity, and workout logging for Obsidian.

Current release: [0.45.3](https://github.com/ZachTish/tps-health/releases/tag/0.45.3) · Obsidian 1.12.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/tps-health` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Log food and workouts

**Log food** searches saved foods and databases together; scanning sits beside search, with Describe and quick-add routes available. The persistent tray keeps unlogged items, and the logger closes through its explicit close button. Categorize food logs with tags instead of a section selector.

Macros can be shown in inline blocks or a dedicated **Macros Base** with native date-range filters. Appearance options include rings for main macros and compact nutrient rows. Meals/recipes and nutrient totals expand into contributing components.

**Start workout** or **Start blank workout** opens the workout flow. Set deletion and separate dropset boundaries are supported. Workout controls appear for an open active workout; rendered content belongs in Live Preview and Reading mode, while Source mode stays literal. Atomic note workouts have their own notes. Atomic line workouts retain a real level-2 heading in the Daily Note for their legacy inline blocks.

## Barcode Flow

The scanner overlays flash, camera-switch, and image-import icons on the camera viewport. Flash is disabled when the camera cannot provide a torch. It no longer shows an Apple Shortcut button. Legacy Shortcut inbox compatibility remains for existing setups.

On iOS, Apple's true VisionKit scanner is native app code; the plugin probes for known native barcode bridge shapes. When no bridge exists, is cancelled, or errors, the web-camera path remains available. Portrait locking is requested while scanning and released on exit; platform support and physical camera/torch behavior require device testing.

USDA credentials use device-local Obsidian SecretStorage. The `DEMO_KEY` fallback is rate-limited; routine tests use synthetic responses rather than spending public quota. A live USDA test requires the optional `USDA_FDC_TEST_API_KEY` test credential. Barcode coverage and serving-size quality still depend on the returned food data; review the selected serving before logging.

## Settings

The hub opens on **Daily logging**; the other routes are **Food & goals**, **Workouts**, **Note library**, and **Integrations & advanced**. Exercise tag and library identification remain configurable. Custom goal JSON and Provider credentials are optional disclosures. Rerenders retain route and scroll position. Food-log tags categorize records; they are not yet per-tag calorie-goal enforcement.

The reference's old `Default food log section` and Apple Shortcut instructions describe legacy compatibility, not controls in the current logger. Native/legacy record migrations remain explicit; changing display preferences does not silently convert records.

## Atomic line compatibility and API

Health no longer registers the retired `tps-health-food-log` Base view. GCM's generic `tps-table` remains available for legacy log tables: `lineFilterKey: food`, `totalsRow: top`, and `createCommandId: tps-health:log-food`. GCM TPS Table scans matching Markdown inline-property lines. The dedicated Macros Base is a separate nutrition summary surface.

The enabled plugin exposes `app.tpsHealth`/`api` for food lookup, exact-food logging, activities, workout plans, and sessions. Prefer a barcode or exact food-note path for deterministic logging. See [the detailed reference](REFERENCE.md) and [src/main.ts](src/main.ts) for API and record contracts; the reference preserves release-specific validation and retired workflows as history.

## Development and repository policy

`main` is the stable source line. Numeric tags identify immutable released artifacts. `optimization` is an unreleased work-in-progress lane; do not install it through BRAT or merge it into stable without separate validation.

The supported build lives inside `Obsidian Plugin Test Vault/Plugin Development`, with `TPS-health (Dev)` as the mapped stable source. These repositories depend on adjacent shared tooling including `deploy-runtime.mjs`; a standalone clone is not currently self-contained.

From the contained workspace, prepare dependencies using the shared helper, then run tests and a separate final build:

```sh
# From Plugin Development:
node ./prepare-dependencies.mjs "TPS-health (Dev)"
cd "TPS-health (Dev)"
npm test
npm run build
```

Dependencies stay in the vault's `.plugin-dev-cache.nosync` through a relative `node_modules` symlink. Use a clean, current checkout; preserve unrelated changes and never build an old dirty worktree into the test runtime. Stable builds deploy only shipped artifacts to the test vault. Optimization builds are build-only. Runtime `data.json`, secrets, caches, and session state never belong in Git.

Documentation-only maintenance does not create a new plugin version. Published release tags and assets are preserved. Do not rely on legacy version/release scripts without reviewing their current behavior. Production updates remain the user's BRAT handoff.

For prior feature details and release-specific evidence, see [REFERENCE.md](REFERENCE.md) and [GitHub releases](https://github.com/ZachTish/tps-health/releases). The September 16 cleanup changes documentation and repository metadata, not shipped behavior.
