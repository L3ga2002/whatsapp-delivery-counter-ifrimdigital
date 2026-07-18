# New Thread Prompt - WhatsApp Delivery Counter

You are the dedicated Codex project thread for `WhatsApp Delivery Counter - IfrimDigital`.

## Read First

Before doing any work, read:

1. `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\THREAD_BOOTSTRAP.md`
2. `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\AGENT_ROUTING_PROTOCOL.md`
3. `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\REGRESSION_QA.md`
4. `.ifrim/NEXT_SESSION.md`
5. `.ifrim/PROJECT_STATE.md`
6. `.ifrim/PRODUCT_BRIEF.md`
7. `.ifrim/PARSER_SPEC.md`
8. `.ifrim/DESKTOP_EXE_SPEC.md`
9. `.ifrim/PREVIEW.md`
10. `.ifrim/AGENTS.md`
11. `.ifrim/OPENCLAW.md`
12. `README.md`
13. `CLAUDE.md`

After reading memory, state the active project, path, preview plan, Git state, and agent routing decision.

## Role

Codex is the coordinator and primary engineer for this project.
OpenClaw agents are IfrimDigital specialist engineers.
Claude Code is an external reviewer/auditor when Codex asks for it.

## Product Objective

Build a real Windows desktop `.exe` app that imports exported WhatsApp group chats and counts courier delivery activity for a selected date/time interval.

The client must be able to:

1. Open the Windows app.
2. Import WhatsApp `.zip` or `.txt` export.
3. Select exact calendar interval, for example Monday 00:00 to Sunday 14:00.
4. Scan only that interval.
5. See counts by courier.
6. Map phone numbers to courier names.
7. Review mismatches and unclear messages.
8. Export report.

## Non-Negotiable Product Rule

Do not use "last 7 days" as the only counting logic.
The primary logic must be exact user-selected interval by date and time.
Quick presets may exist later, but custom interval is required.

## Production Implementation Rule

Do not implement as a demo. Implement as a real production feature, with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.

## Regression QA Rule

After any non-trivial feature, optimization, refactor, UI change, parser/data change, export/import change, packaging change, or bug fix, apply `REGRESSION_QA.md`.

Do not mark work complete only because build passes. Verify the desktop app like a real user: import valid/invalid WhatsApp files, select intervals, check counts, mismatch rows, aliases, exports, duplicate imports, readable tables/buttons/dialogs, and adjacent flows that share parser/state/persistence.

## Technical Direction

Preferred stack:

- Electron
- React
- TypeScript
- Vite
- Local parser/service in Electron main process
- Local persistence for courier aliases
- Windows packaging with electron-builder

Use ports:

- Vite preview: `http://127.0.0.1:3001`
- No production HTTP backend unless architecture changes

## First Engineering Task

Scaffold the desktop app and implement the first vertical slice:

- file import UI
- accept `.zip` and `.txt`
- parse Romanian WhatsApp export lines
- date/time interval picker
- status detection for `ridicat` and `livrat`
- quantity detection from `x1`, `x2`
- summary table by courier
- unknown courier alias mapping placeholder
- review list for mismatches/unclear messages

Use the real production rule above.

## Safety

- Do not touch ProDelivery.
- Do not push to GitHub unless Catalin explicitly asks.
- Planned separate repo: `L3ga2002/whatsapp-delivery-counter-ifrimdigital`.
- Do not copy external-builder branding into the product.
