# OpenClaw report: ifrim-reviewer

Generated: 2026-06-24T00:48:30.4304482+03:00


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
[P1] Mixed restaurant/pontaj imports have no usable UI path  
File/line: `src/renderer/App.tsx:720`, `src/renderer/App.tsx:724`, `src/renderer/App.tsx:739`, `src/renderer/App.tsx:2709`  
Owner/Fixer: ifrim-frontend  
Evidence: `handleImportClick` only imports `workHours` or `restaurant`; `validateScanImports` explicitly treats `mixed` as valid, but the user cannot create one from the guided UI.  
Impact: a WhatsApp group containing both order and availability signals cannot be scanned for both workflows. Importing as restaurant loses pontaj at scan time; importing as pontaj loses orders. This is a pre-delivery product blocker for real mixed chats.  
Fix recipe:  
1. Add a ÔÇťRestaurant + pontajÔÇŁ import mode, or auto-classify as `mixed` when imported content has both delivery and availability messages.  
2. Keep restaurant selection required for the order side of a mixed import.  
3. Add coverage for one mixed import scanned with `Comenzi`, `Ore lucrate`, and `Timpi livrare` enabled.  
Verification command: `npm test && npx tsc --noEmit`

[P1] Restaurant Excel exports drop scoped review details  
File/line: `src/renderer/App.tsx:1779`, `src/renderer/App.tsx:1986`, `src/renderer/App.tsx:2001`  
Owner/Fixer: ifrim-frontend  
Evidence: `createScopedReport` builds scoped `reviewRows`, but `buildReportWorkbook` only calls `addReviewSheet` when `include('review')` is true. For `scope: 'restaurants'`, the workbook gets report sheets but no `Review` sheet.  
Impact: per-restaurant exports can show review counts/mismatches without the actual review rows needed to verify client-facing errors.  
Fix recipe:  
1. Add `Review` to `scope: 'restaurants'` exports when `scopedReport.reviewRows.length > 0`.  
2. Ensure the sheet uses only scoped rows.  
3. Add a regression export test or smoke script that creates a restaurant-scoped workbook with a review row and asserts a `Review` worksheet exists.  
Verification command: `npm test && npx tsc --noEmit`

[P2] Scoped mismatch rows still lose source-message context  
File/line: `src/renderer/App.tsx:1777`, `src/renderer/App.tsx:1819`, `src/renderer/App.tsx:1892`, `src/renderer/App.tsx:1925`  
Owner/Fixer: ifrim-frontend  
Evidence: scoped export computes `selectedMessageIds`, but `buildCourierSummariesFromDailyRows` initializes `sourceMessageIds: []`; scoped mismatch rows then filter an empty array.  
Impact: restaurant-scoped mismatch rows cannot point back to the source WhatsApp messages, weakening the review/audit workflow.  
Fix recipe:  
1. Carry source message IDs into daily summaries, or rebuild scoped mismatches from restaurant/courier source messages rather than daily rows.  
2. Include those IDs in scoped mismatch rows.  
3. Add a regression where a selected restaurant has a mismatch and the scoped mismatch row includes source IDs.  
Verification command: `npm test && npx tsc --noEmit`

[P2] Restaurant-scoped export is keyed by mutable names  
File/line: `src/renderer/App.tsx:680`, `src/renderer/App.tsx:1772`, `src/renderer/App.tsx:1775`  
Owner/Fixer: ifrim-frontend  
Evidence: export options start from restaurant IDs, but scoped filtering converts IDs to `restaurant.name` and filters summaries by name.  
Impact: renaming a restaurant after scan, or having duplicate names, can make a selected restaurant export empty or include the wrong rows.  
Fix recipe:  
1. Preserve restaurant IDs through scan summaries/export rows.  
2. Filter scoped exports by stable ID, using names only as labels.  
3. Verify by scanning a restaurant, renaming it, then exporting by ID.  
Verification command: `npm test && npx tsc --noEmit`

Verification run: `npm test` passed 39/39; `npx tsc --noEmit` passed. I did not run `npm run build` because it rewrites generated output, and this was review-only.
