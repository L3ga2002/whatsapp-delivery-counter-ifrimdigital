# Changelog - WhatsApp Delivery Counter

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
