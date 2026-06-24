# OpenClaw report: ifrim-frontend-reviewer

Generated: 2026-06-24T00:48:31.3599669+03:00


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
Review-only pass complete. I did not edit files, commit, push, or touch ProDelivery. `npm test -- --run` passed 39/39, and `npx tsc --noEmit` passed. I skipped `npm run build` because it rewrites generated output.

[P1] Mixed restaurant/pontaj chats cannot be scanned for both workflows  
File/line: `src/renderer/App.tsx:720`, `src/renderer/App.tsx:2706`, `electron/main.ts:415`  
Owner: ifrim-frontend  
Evidence: the import UI only calls `onImport('workHours', '')` or `onImport('restaurant', restaurantId)`, while validation expects a `mixed` role for combined scans, and Electron only materializes availability messages for `workHours`/`mixed`.  
Impact: if the client imports one WhatsApp group that contains both delivery and availability signals, there is no UI path to scan both orders and worked hours from that import. Importing it as restaurant drops pontaj at scan time; importing it as pontaj drops orders.  
Fix recipe:  
1. Add a client-friendly ÔÇťRestaurant + pontajÔÇŁ import mode or infer mixed when both message types are present.  
2. Update `validateScanImports` and `materializeReportInputs` so scan options, not just import role, decide which parsed signals are usable.  
3. Add a renderer/workspace test for one import with both `messages` and `availabilityMessages` scanned with all modules enabled.  
Verification command: `npm test -- --run && npx tsc --noEmit`

[P2] Mismatch review rows cannot open conversation context  
File/line: `src/renderer/App.tsx:1730`  
Owner: ifrim-frontend  
Evidence: `ReviewContext` immediately returns an empty-state message for `row.kind === 'mismatch'`, even though mismatch rows carry `sourceMessageIds`.  
Impact: the review workflow promises click-through evidence, but the most important errors, picked-up vs delivered differences, send the operator to a dead end instead of the exact source messages.  
Fix recipe:  
1. Resolve mismatch `sourceMessageIds` back to imported conversation lines and render grouped context snippets.  
2. For multi-message mismatches, show each source message with file, line, timestamp, sender, and raw line.  
3. Add a test/preview scenario with a mismatch row and verify clicking it shows the source lines.  
Verification command: `npm test -- --run && npx tsc --noEmit`

[P2] Restaurant-scoped export is keyed by mutable restaurant names  
File/line: `src/renderer/App.tsx:680`, `src/renderer/App.tsx:1767`  
Owner: ifrim-frontend  
Evidence: quick export options match scanned rows by `restaurant.name`, and `createScopedReport` converts selected IDs to names before filtering `dailyCourierSummaries` / `restaurantSummaries`.  
Impact: if a restaurant is renamed after scan, or two restaurants share a name, restaurant export can disappear or include the wrong rows. This is risky for client-facing per-restaurant reports.  
Fix recipe:  
1. Preserve restaurant IDs in scan summaries or keep an ID/name mapping from report imports through report generation.  
2. Filter scoped exports by stable restaurant ID, using names only for labels.  
3. Add a regression test: scan/import restaurant A, rename it, then export by ID and verify rows still appear.  
Verification command: `npm test -- --run && npx tsc --noEmit`

[P3] ÔÇťPrepare new reportÔÇŁ leaves the old report active  
File/line: `src/renderer/App.tsx:716`  
Owner: ifrim-design  
Evidence: `createNewReportDraft` only clears the draft form; it does not clear `selectedReportId` or hide import/scan actions for the currently selected report.  
Impact: an operator can click ÔÇťPregateste raport nouÔÇŁ, see empty fields, then accidentally import files into the previous report because it remains selected.  
Fix recipe:  
1. Rename the action to ÔÇťGoleste formularulÔÇŁ or introduce a real new-report state that clears the selected report.  
2. Disable import/scan until the new report is saved.  
3. Preview flow: select an existing report, click prepare new, confirm import panel cannot target the old report accidentally.  
Verification command: `npx tsc --noEmit`
