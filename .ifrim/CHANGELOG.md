# Changelog - WhatsApp Delivery Counter

## 2026-08-16 - v0.3.22

- Added additive parser support for `Completare comanda`, `Ridicat pos`, `Retur pos`, and pickup variants written as `Preluat` or `Luat`.
- Added zone allocation tolerance for forms such as `1 zona 2` without the usual `x` or parentheses, while preserving the existing explicit forms.
- Delivery zone/exterior details now correct an explicit pickup classification when the courier fixes the zone in the `Livrat` message; the source pair remains visible in Review.
- Added parser regressions for the new client-provided message forms and the corrected pickup/delivery zone flow.

## 2026-07-20 - v0.3.19

- Replaced the Windows-native restaurant schedule inputs with an explicit 24-hour selector: hours `00` through `23` and minutes `00` through `59`, independent of Windows AM/PM settings.
- Deleting a courier now invalidates scanned, verified, and exported reports that may still contain that courier's WhatsApp identity, then safely recalculates the currently open report when possible.
- Serialized local workspace saves and prevented reload actions during an active operation, reducing the risk of a temporary locked-input state or concurrent local persistence writes.
- Added regression coverage for courier deletion across scanned, verified, and exported report states.

## 2026-07-20 - v0.3.18

- Excluded inactive courier identities from the live alias map, preventing old aliases from grouping new scan rows under historical courier names.
- Rescan the selected report after every courier save, including when the result view is temporarily unloaded.
- Clarified the UI distinction between saved courier records and couriers detected in scanned WhatsApp conversations.
- Added a regression test for inactive aliases and verified the Windows installer, portable build, and SHA-256 release hashes.

## 2026-07-15 - v0.3.14

- Added an opt-in final salary workbook modeled on the client's XLSM calculations, using standard Excel formulas without requiring macros.
- Added persistent Z1/Z2/Z3 day/night tariffs, restaurant payment methods, courier commission/tax rules, and restaurant-courier overrides.
- Added a professional `Raport salarial` summary, restaurant worksheets, visible salary warnings, and hidden calculation/audit sheets.
- Separated gross commission, the client's global commission adjustment, and net team commission so totals remain auditable.
- Improved narrow-window salary settings with local field labels and locked the full form while settings are saved.
- Expanded payroll and workbook regression coverage, including explicit activation and the client's `DOAR CASH` rule.

## 2026-07-15 - v0.3.13

- Added explicit mapping from sender identities detected in imported WhatsApp conversations to saved couriers, covering exports that contain a contact name but no phone number.
- Kept courier matching deterministic and payroll-safe: no fuzzy name matching is used, and rescanning applies the saved identity mapping to app totals and Excel exports.
- Simplified the primary Excel export to professional restaurant-only worksheets; technical/global exports remain available through their dedicated scopes.
- Added operation timeouts, a UI watchdog, and an always-available reload action so a stalled local request cannot leave text fields locked until restart.
- Removed the calendar focus race caused by forced autofocus and improved outside-click/outside-focus handling.
- Added regression tests for contact-name aliases, phone normalization, fuzzy-match rejection, and restaurant-only workbook tabs.

## 2026-07-15 - v0.3.12

- Added courier editing with explicit save/cancel actions and preserved the previous courier name automatically as a WhatsApp alias after renaming.
- Invalidated scanned reports after courier identity changes so rescanning always applies the current alias map.
- Fixed the calendar outside-click focus race that could make text fields appear blocked until restarting the app.
- Renamed exterior deliveries to `Comenzi speciale` throughout the UI and Excel reports without changing their calculation semantics.
- Added a normalized `EXPORT_SAPTAMANAL` worksheet compatible with the client's salary workbook columns, while leaving salary revenue fields empty for the client's configured formulas.
- Kept `EXPORT_SAPTAMANAL` to the exact 11-column import contract; special-order details remain in the technical worksheets.
- Avoided unnecessary report rescans for notes-only or identical courier saves while retaining invalidation for alias, phone, name, and active-state changes.
- Protected unsaved courier edits and disabled form fields while persistence is in progress.
- Pinned the verified Windows packaging toolchain to `electron-builder 25.1.8`.
- Verified real Electron editing, calendar-to-input focus, a saved-report scan, full Excel export, XML structure, rendered workbook layout, and formula-error scan.

## 2026-07-12 - v0.3.11

- Replaced the Windows-dependent date input with a Romanian Monday-first calendar and separate time selector.
- Restored legacy courier aliases into SQLite with a non-destructive backup and visible migration warnings.
- Normalized Romanian phone aliases across `07`, `+40`, and `0040` formats and rejected ambiguous duplicate ownership.
- Invalidated saved scan results after courier changes so reports are recalculated with current aliases.
- Hardened renderer error messages and Vitest generated-output exclusions.
- Upgraded Electron, electron-builder, and Vitest to patched current versions; rebuilt installer, portable app, update metadata, and SHA-256 hashes.
- Verified a real saved-report scan and rendered the generated Excel workbook for visual QA.

## 2026-06-23

- Added mandatory central thread bootstrap and agent routing requirement to `NEXT_SESSION.md` and `THREAD_PROMPT.md`.
- Threads must now state whether they use Codex only, OpenClaw, Claude Code, or a hybrid flow before non-trivial work.
- Sent bootstrap reminder to the known WhatsApp Delivery Counter Codex thread.

## 2026-06-12

- Initialized IfrimDigital project memory.
- Added product brief for WhatsApp export delivery counting.
- Added parser spec for Romanian WhatsApp `.txt` exports.
- Added desktop `.exe` packaging direction.
- Added dedicated new-thread prompt.
- Reserved preview port 3001 in the central port registry.
- Added full Claude Code agent set for architecture, parser/local-services, frontend, security, QA, implementation, Opus principal review, and Windows desktop packaging.
- Replaced active Fable routing with Claude 4.8 Opus / CLI alias `opus`; kept `fable` only as a legacy script alias.
- Added project-specific OpenClaw routing in `.ifrim/OPENCLAW.md`.

## 2026-06-21

- Implemented v0.2 professional reporting workspace with SQLite local persistence, restaurants, couriers, saved reports, report imports, scan options, and parser version metadata.
- Added sidebar UI: Dashboard, Rapoarte, Restaurante, Curieri, Setari, with a larger IfrimDigital badge and less crowded operational screens.
- Added saved report workflow: create report interval, attach restaurant/work-hours/mixed imports, scan saved imports, and view global courier, restaurant, daily, work-hours, and review panels.
- Added flexible Excel export scopes: full report, global couriers, selected restaurants, review-only, and work-hours-only.
