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
[P2] Initial workspace-load errors are hidden behind infinite loading  
File/line: `src/renderer/App.tsx:89`, `src/renderer/App.tsx:103`, `src/renderer/App.tsx:336`  
Owner: ifrim-frontend  
Evidence: `reloadWorkspace()` sets `notice` when Electron API/workspace load fails, but render returns only the loading screen while `workspace` is null.  
Impact: users see “Incarc workspace-ul local...” forever instead of the actual error/retry path.  
Fix recipe:  
1. Track `loadError`/`loadState` and render an error panel with retry before the loading fallback.  
2. Add a component test or mocked `getWorkspace` failure path.  
3. Preview by forcing `getWorkspace` to throw.  
Verification command: `npm run build && npm test`

[P2] Review mismatch clicks do not open conversation context  
File/line: `src/renderer/App.tsx:1664`, `src/renderer/App.tsx:1674`  
Owner: ifrim-frontend  
Evidence: every review row is clickable, but `ReviewContext` immediately returns generic text for `row.kind === 'mismatch'` even though mismatch rows carry `sourceMessageIds`.  
Impact: users cannot investigate picked-up/delivered mismatches from the UI.  
Fix recipe:  
1. Resolve `sourceMessageIds` against imported files and show the relevant conversation windows grouped by source.  
2. Add a UI/unit test for mismatch review context.  
3. Verify by clicking a mismatch row after scan.  
Verification command: `npm run build`

[P2] Paid-order totals are surfaced with ambiguous non-paid labels  
File/line: `src/shared/parser.ts:332`, `src/shared/parser.ts:356`, `src/renderer/App.tsx:1448`, `src/renderer/App.tsx:1950`  
Owner: ifrim-design | ifrim-frontend  
Evidence: parser aggregates `paidQuantity`/`paidZoneCounts` into `pickedUp` and zone totals, but UI/export headers still say `Total zi`, `Z1 zi`, etc.  
Impact: after paid-order parsing, users cannot tell whether result tables represent all pickups or paid-counted orders.  
Fix recipe:  
1. Rename table/export headers to paid-specific wording or add separate paid-order columns after raw order columns.  
2. Add parser/report fixture covering paid vs raw quantity display.  
3. Verify UI and Excel headers on a paid-order chat sample.  
Verification command: `npm test`

[P3] Export filenames collide across full/restaurant/review exports  
File/line: `src/renderer/App.tsx:321`  
Owner: ifrim-frontend  
Evidence: every export downloads as `raport-whatsapp-${date}.xlsx`, regardless of selected report, scope, or restaurant.  
Impact: users doing multiple exports in one session can overwrite or confuse files.  
Fix recipe:  
1. Include report name, scope, and selected restaurant/review in the filename.  
2. Add a small filename formatter test.  
3. Verify full, restaurant, and review exports produce distinct names.  
Verification command: `npm run build`
