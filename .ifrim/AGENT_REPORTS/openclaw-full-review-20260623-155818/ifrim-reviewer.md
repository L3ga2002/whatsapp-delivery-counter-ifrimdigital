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
[P1] Legacy v0.2 imports can poison paid totals with `NaN`  
File/line: `src/shared/parser.ts:332`, `src/shared/parser.ts:356`, `electron/workspace-store.ts:629`, `src/shared/types.ts:17`  
Owner: ifrim-backend  
Evidence: persisted imports are loaded with `JSON.parse(...)` unchanged, while scans now do `summary.pickedUp += message.paidQuantity` / `summary.nightPickedUp += message.paidQuantity`. Older saved imports do not have the new `paidQuantity`, `paidZoneCounts`, or exterior paid fields. `PARSER_VERSION` is still `0.2.0`, so the app cannot distinguish/reparse paid-rule-era imports.  
Impact: existing v0.2 workspaces can rescan old reports into `NaN` totals or broken Excel values after upgrading to the paid-order parser.  
Fix recipe:  
1. Bump parser version for the paid-field schema/rules, e.g. `0.3.0`.  
2. Add a normalization/migration step when loading `import_result_json`: backfill paid fields from old messages or force/recommend reimport for imports parsed before the paid parser version.  
3. Add a regression test with a legacy `ParsedDeliveryMessage` object missing paid fields and verify totals stay numeric.  
Verification command: `npm test`

[P1] Mixed zone plus exterior lei pickups are classified as all exterior  
File/line: `src/shared/parser.ts:1688`  
Owner: ifrim-backend  
Evidence: once any lei amount is present, `classifyPaidDelivery` returns `paidZoneCounts` as empty and `paidOutsideZoneDeliveries: paidQuantity`. For `Ridicat x2 (1 x zona 2 + 45 lei)`, the zone classifier can see the zone, but the lei branch discards it and marks both orders exterior.  
Impact: client payout exports undercount zone orders and overcount exterior orders whenever one pickup message contains both a zoned order and an exterior lei order.  
Fix recipe:  
1. Treat lei amount as exterior for only the unclassified remainder, not the full `paidQuantity`.  
2. Preserve explicit zone quantities from `classifyPaidZones`; do not default the lei remainder to Zone 1.  
3. Add tests for `Ridicat x2 (1 x zona 2 + 45 lei)` expecting `paidZoneCounts.zone2 = 1`, `paidOutsideZoneDeliveries = 1`, `paidOutsideAmountLei = 45`, `paidZoneCounts.zone1 = 0`.  
Verification command: `npm test -- src/shared/parser.test.ts`

[P1] Standalone `completare` paid orders are not parsed  
File/line: `src/shared/parser.ts:1302`, `src/shared/parser.ts:1314`, `src/shared/parser.ts:1323`, `src/shared/parser.ts:1669`  
Owner: ifrim-backend  
Evidence: `detectStatus` recognizes normal statuses or direct returns. `COMPLETION_REGEX` is only used as fuzzy-status context, and `classifyPaidDelivery` immediately returns zero unless the detected status is `ridicat`. A message like `Completare x1` has no status match and no return match, so it is dropped.  
Impact: paid completion orders are missing from totals unless couriers also write `ridicat`, which contradicts the latest paid-order rule scope.  
Fix recipe:  
1. Add a direct completion detection path analogous to `retur`, mapping completion to a paid `ridicat`-style message with `paidSource: 'completion'`.  
2. Keep it conservative: require `completare` plus quantity, money, zone, or clear standalone action, and flag for review.  
3. Add tests for `Completare x1`, `Completare comanda`, and conversational completion text that must not count.  
Verification command: `npm test -- src/shared/parser.test.ts`

[P2] Restaurant-scoped mismatch rows lose review context IDs  
File/line: `src/renderer/App.tsx:1721`, `src/renderer/App.tsx:1763`, `src/renderer/App.tsx:1869`  
Owner: ifrim-frontend  
Evidence: `createScopedReport` computes `selectedMessageIds`, but `buildCourierSummariesFromDailyRows` initializes `sourceMessageIds: []` and never fills it from daily rows. Scoped mismatch rows then use `summary.sourceMessageIds.filter(...)`, producing empty context IDs.  
Impact: restaurant-scoped exports can show recomputed mismatch rows without the source message context needed for review/debugging.  
Fix recipe:  
1. Carry source message IDs into `DailyCourierSummary`, or rebuild scoped courier summaries from source-level rows that still have IDs.  
2. Ensure `buildScopedMismatchRows` receives the selected restaurant’s actual message IDs per courier.  
3. Add a scoped export regression test where a selected restaurant has a mismatch and assert the scoped mismatch row includes the selected pickup/delivery message IDs.  
Verification command: `npm test`
⚠️ 🛠️ `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'npm test -- --runInBand' (in ~\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter)` failed
