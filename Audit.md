# TPS-Health (Dev) — Audit

Scope
- Reviewed files: [`src/main.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-health%20(Dev)/src/main.ts), [`src/api.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-health%20(Dev)/src/api.ts), [`src/settings.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-health%20(Dev)/src/settings.ts), [`src/format.ts`](/Users/zachtisherman/TishOS%20v0.1/.obsidian/plugins/TPS-health%20(Dev)/src/format.ts).

Where issues are
- High: The plugin exposes state through shared app-level surfaces and ad-hoc mutable properties, increasing collision risk and making unload/reload behavior difficult to guarantee.
- High: Scan/repair/refresh scheduling appears to use interval-style cadence and manual re-hooks in multiple paths, which can overlap and duplicate work.
- High: Error observability is weak for failing scans; users and support lose detail about which file/action failed.
- Medium: Cross-plugin integration still relies on fallback plugin IDs and permissive typings; contract drift becomes silent no-op behavior.
- Medium: Queue handling for repair workflows has no strict dedupe strategy and can process the same file multiple times under certain UI loops.
- Low: Settings-driven format and display code is coupled to collection logic, so rendering failures may skip scan behavior.

User interaction risks
- Health indicators can lag behind real state because stale interval tasks are still finishing after settings changes.
- Users might repeatedly trigger heavy scans while UI appears idle, which can slow notes with large vaults.
- Failure causes are difficult to pinpoint, causing manual retries with no correction hints.

Improvements
- Replace ad-hoc global exposure with a dedicated typed API adapter and explicit register/unregister lifecycle.
- Consolidate scan, queue, and menu refresh into one cancellable scheduler with backoff and single-flight guards.
- Add structured error payloads from scan/repair (`file`, `operation`, `duration`, `errorCode`) and surface actionable notices in UI.
- Add explicit contract registration and feature checks for Controller/GCM/Messager before invoking cross-plugin operations.
- Add idempotency guards for repair tasks and long-running queue entries.

How to simplify/centralize
- Standardize queue architecture across Health/Finances/Controller with shared dedupe + retry helpers.
- Move shared formatting and diagnostics hooks into a common `tps-metrics` module.
- Align health output shape with centralized tps-event schema used across plugins.
