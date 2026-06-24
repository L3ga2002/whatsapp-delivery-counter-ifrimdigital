|
o  Doctor warnings ------------------------------------------------------+
|                                                                        |
|  - Left plugin install index in place because shared SQLite state has  |
|    conflicting plugin install metadata for: codex                      |
|                                                                        |
+------------------------------------------------------------------------+
[state-migrations] Legacy state migration warnings:
- Left plugin install index in place because shared SQLite state has conflicting plugin install metadata for: codex
|
o  Doctor warnings ------------------------------------------------------+
|                                                                        |
|  - Left plugin install index in place because shared SQLite state has  |
|    conflicting plugin install metadata for: codex                      |
|                                                                        |
+------------------------------------------------------------------------+
[plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load: codex (C:\Users\mihai\.openclaw\npm\projects\openclaw-codex-8902d781d4\node_modules\@openclaw\codex\dist\index.js). Set plugins.allow to explicit trusted ids.
[P1] Legacy imports can break or zero paid-order scans  
File/line: `src/shared/parser.ts:332`, `src/shared/parser.ts:357`, `electron/workspace-store.ts:629`  
Owner: ifrim-backend  
Evidence: `rowToReportImport` deserializes old `import_result_json` directly, while `buildScanReport` now assumes every `ridicat` message has `paidQuantity` and `paidZoneCounts`. Imports saved before the 2026-06-22 paid-field change will have neither.  
Impact: historical reports can throw on `addZoneCounts(..., message.paidZoneCounts)` or produce `NaN` paid totals, corrupting report/Excel output.  
Fix recipe:  
1. Add a normalization step when reading `import_result_json` or before scan that backfills paid fields for old `ParsedDeliveryMessage` records.  
2. Add a legacy-import fixture with `ridicat x1 zona 2` missing all `paid*` fields.  
3. Verify old saved imports scan to sane paid totals.  
Verification command: `npm test`

[P1] Multi-file ZIP import collapses separate chats into one restaurant  
File/line: `electron/main.ts:246`, `electron/main.ts:250`, `electron/workspace-store.ts:261`, `electron/main.ts:307`  
Owner: ifrim-backend  
Evidence: ZIP text entries are flattened into one `ImportResult`; `saveReportImport` stores one `restaurantId`; `materializeReportInputs` rewrites every parsed message’s `restaurantName` to that one selected restaurant. Spec says multi-text ZIPs must be selected or scanned separately (`.ifrim/PARSER_SPEC.md:10`).  
Impact: ZIPs containing multiple restaurant exports silently aggregate all orders under one restaurant, making restaurant summaries and Excel reports wrong.  
Fix recipe:  
1. Reject multi-`.txt` ZIPs for restaurant imports until each entry can be mapped separately, or create one `ReportImport` per ZIP entry with explicit restaurant mapping.  
2. Add a ZIP import test with two `.txt` chats and distinct restaurant labels.  
3. Verify scan/export preserves separate restaurant summaries or blocks the import with a clear error.  
Verification command: `npm test`

[P2] Night difference is always reported as zero  
File/line: `src/shared/parser.ts:664`, `src/shared/parser.ts:681`, `src/shared/parser.ts:689`, `src/renderer/App.tsx:2167`  
Owner: ifrim-backend  
Evidence: `buildScanReport` calculates total `difference`, then hardcodes `nightDifference: 0` for courier, restaurant, and daily rows. The Night Excel sheet exports `row.nightDifference`.  
Impact: night audit mismatches are hidden in UI/Excel, and scoped night mismatch rows in `buildScopedMismatchRows` can never fire.  
Fix recipe:  
1. Compute `nightDifference = nightPickedUp - nightDelivered`; decide whether `difference` should remain all-day total or become day-only and update labels accordingly.  
2. Add tests for night `ridicat x2` / `livrat x1`.  
3. Verify Night sheet and review rows show the mismatch.  
Verification command: `npm test`

Verification run: `npm test` passed, 36/36 tests.
⚠️ 🛠️ `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'npm test -- --runInBand' (in ~\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter)` failed
