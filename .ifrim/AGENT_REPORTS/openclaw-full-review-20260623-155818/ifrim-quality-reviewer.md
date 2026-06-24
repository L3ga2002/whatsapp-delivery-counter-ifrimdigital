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
Confirmed findings only. `npm test`, `npx tsc --noEmit`, `npm run build:electron`, and full `npm run build` passed; no P0 undefined-variable/TypeScript blocker found.

[P1] Word-number parsing can overcount paid/delivery quantities  
File/line: [src/shared/parser.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.ts:1552>)  
Owner/fixer: ifrim-backend  
Category: brittle regex / paid-order regression risk  
Evidence: `detectWordQuantity()` is accepted when `statusThenQuantity` finds `doua/doi` within 0-4 words after status. Runtime probe: `ridicat la ora doua` parsed as `{status:"ridicat", quantity:2}`.  
Impact: ordinary Romanian timing/context phrases can be counted as two paid orders, inflating courier totals.  
Fix recipe: Restrict word-number quantities to explicit order grammar near status, or mark ambiguous word quantities as review-only without adding to paid totals. Add tests for `ridicat la ora doua`, `ridicat dupa ora doua`, `livrat la doi pasi`.  
Verification command: `npm test`

[P1] Night mismatch is always hidden  
File/line: [src/shared/parser.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.ts:664>) and [src/renderer/App.tsx](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\renderer\App.tsx:2167>)  
Owner/fixer: ifrim-backend + ifrim-frontend  
Category: regression risk / maintainability  
Evidence: `buildScanReport()` calculates `difference` as day+night net, but sets `nightDifference: 0` for courier, restaurant, and daily rows. Probe output for 1 day pickup, 0 day deliveries, 1 night pickup, 2 night deliveries: `difference: 0`, `nightDifference: 0`, `reviewRows: []`. The Night Excel sheet exports `row.nightDifference`.  
Impact: night pickup/delivery imbalance can be reported as balanced and exported as `0`.  
Fix recipe: Define clear semantics: either make `difference` day-only and `nightDifference = nightPickedUp - nightDelivered`, or keep total difference and add a separate computed night mismatch field. Update UI totals/review row creation accordingly.  
Verification command: `npm test && npm run build`

[P2] Paid-order aggregation rules are under-tested  
File/line: [src/shared/parser.test.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.test.ts:294>) and [src/shared/parser.test.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.test.ts:501>)  
Owner/fixer: ifrim-qa  
Category: missing tests  
Evidence: tests assert `paidSource`, `paidOutsideAmountLei`, returns, and completions at parse-message level, but `buildScanReport()` aggregation coverage only checks one `ridicat x1 zona 2` case.  
Impact: regressions in report totals for `Ridicat 45 lei`, `Retur`, `Anulat(retur)`, completions, and night paid buckets can pass the suite.  
Fix recipe: Add `buildScanReport()` tests asserting courier, restaurant, daily, and total fields for paid outside lei, return, completion, night return/completion, and mixed zone+lei review behavior.  
Verification command: `npm test`

[P2] Oversized, high-complexity functions concentrate regression risk  
File/line: [src/shared/parser.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.ts:196>), [src/shared/parser.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.ts:994>), [src/renderer/App.tsx](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\renderer\App.tsx:56>)  
Owner/fixer: ifrim-backend + ifrim-frontend  
Category: complexity / long function  
Evidence: TypeScript AST scan: `buildScanReport loc=587 complexity~54`, `parseRelevantEntry loc=173 complexity~26`, `App loc=378 complexity~61`, `ReportsView loc=416 complexity~47`.  
Impact: paid totals, work hours, delivery timing, review rows, and export UI are hard to change safely because unrelated rules share large mutation-heavy functions.  
Fix recipe: Extract report aggregation helpers for summary creation, pickup accounting, delivery accounting, availability review, totals finalization; split `App.tsx` views/export workbook into focused modules. Keep behavior locked with current parser/report tests first.  
Verification command: `npm test && npm run build`

[P2] Dead code is present and the build does not gate it  
File/line: [src/shared/parser.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.ts:1857>), [src/shared/parser.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.ts:2021>), [electron/main.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\electron\main.ts:264>), [src/renderer/App.tsx](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\renderer\App.tsx:1923>)  
Owner/fixer: ifrim-backend + ifrim-frontend  
Category: dead code / lint-build risk  
Evidence: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false` reports unused `isOutsideDeliveryMessage`, `formatLocalDateLabel`, `readAliases`, and `restaurants`. `tsconfig` has `strict` only, no `noUnused*`; no lint config/script found.  
Impact: stale code and unused parameters can accumulate without CI failing, making future parser/export changes harder to audit.  
Fix recipe: Remove unused symbols or wire them into real behavior; enable `noUnusedLocals` and `noUnusedParameters`, or add ESLint with equivalent rules.  
Verification command: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false`

[P2] Corrupt workspace JSON is silently replaced with defaults  
File/line: [electron/workspace-store.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\electron\workspace-store.ts:633>)  
Owner/fixer: ifrim-backend  
Category: empty handler / maintainability  
Evidence: `parseJsonList()` catches JSON parse errors and returns `[]`; `parseScanOptions()` catches and returns `defaultScanOptions` without logging or surfacing a workspace issue.  
Impact: corrupted aliases/list fields or scan options can disappear silently, making report changes hard to trace.  
Fix recipe: Log the field/report id, preserve a recoverable warning in workspace load results, and validate parsed shape before accepting it. Add tests for malformed JSON in stored aliases/scan options.  
Verification command: `npm test && npm run build:electron`
⚠️ 🛠️ `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'npx …noEmit --noUnusedLocals --noUnusedParameters --pretty false' (in ~\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter)` failed
