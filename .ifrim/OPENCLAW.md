# OpenClaw - WhatsApp Delivery Counter

This project can use the global IfrimDigital OpenClaw agent team configured on this machine.

## Important Paths

- OpenClaw config: `C:\Users\mihai\.openclaw\openclaw.json`
- Main OpenClaw workspace prompt: `C:\Users\mihai\.openclaw\workspace\AGENTS.md`
- IfrimDigital agent workspaces: `C:\Users\mihai\.openclaw\workspace-ifrim-team\`
- OpenClaw dashboard/gateway: `http://127.0.0.1:18789/`
- Project path: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter`

## Coordinator Rule

Codex is the coordinator and final reviewer. OpenClaw agents are IfrimDigital specialist engineers.

OpenClaw outputs are specialist reports or task packets. Codex decides what is accepted, what gets implemented, and what must be verified.

Use OpenClaw when a task benefits from focused specialist analysis, parallel review, QA verification, or implementation ownership.

## Available Agents

- `ifrim-architect`: Electron architecture, app boundaries, IPC/service design, task slicing, risks, acceptance criteria.
- `ifrim-product`: courier counting workflow, report rules, client-facing UX, wording, business value.
- `ifrim-migration`: import/export inspection, cleanup, local run plans, moving code without mixing projects.
- `ifrim-frontend`: React, Vite, desktop UI behavior, interval picker, report tables, loading/error states.
- `ifrim-backend`: local parser/service logic, zip/txt import, aggregation, persistence, exports.
- `ifrim-qa`: parser tests, interval boundary tests, import/export smoke checks, regression checks.
- `ifrim-design`: desktop app UX, visual hierarchy, table readability, review/mismatch workflow.
- `ifrim-integrations`: future integrations, export formats, AI-assisted parsing if later approved.
- `ifrim-devops`: local preview, scripts, Electron build commands, `.exe` packaging readiness.
- `ifrim-mobile`: not a primary agent for this MVP; use only if future mobile companion work appears.
- `ifrim-prototype`: quick feasibility spikes and throwaway parser/UI experiments.
- `ifrim-reviewer`: lead code reviewer and synthesis across specialist findings.
- `ifrim-backend-reviewer`: parser correctness, file import, local persistence, report aggregation, tests.
- `ifrim-frontend-reviewer`: React state, UI flows, accessibility, report layout, user error handling.
- `ifrim-security-reviewer`: local file handling, zip safety, IPC exposure, privacy, logs, packaged app contents.
- `ifrim-devops-reviewer`: preview, build scripts, electron-builder, release artifacts, packaging logs.
- `ifrim-quality-reviewer`: static quality scorecard, undefined variables, complex functions, dead code, lint/build risk.

## Review Flow

1. Codex defines scope and asks `ifrim-reviewer` for review planning or synthesis when needed.
2. Specialist reviewers inspect their area and report only.
3. Each finding must include:
   - severity
   - file/line
   - evidence
   - impact
   - suggested owner/fixer
   - concrete fix recipe
   - verification command
4. Codex assigns fixes to implementation agents.
5. `ifrim-qa` verifies after fixes.

## Implementation Flow

Use implementation agents only for clearly assigned fixes:

- parser/import/export/local service fixes -> `ifrim-backend`
- React/Electron renderer fixes -> `ifrim-frontend`
- scripts/build/package fixes -> `ifrim-devops`
- UX/layout polish -> `ifrim-design`
- product rules/report logic -> `ifrim-product`
- future external integrations -> `ifrim-integrations`

Review agents do not edit files.

## Production Implementation Rule

Before any implementation task:

Do not implement as a demo. Implement as a real production feature, with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.

## Product Non-Negotiables

- This is a Windows desktop app, not only a web app.
- It must be buildable as a `.exe`.
- The primary scan mode is exact custom date/time interval.
- "Last 7 days" can be only a preset, never the only logic.
- Import `.zip` and `.txt` WhatsApp exports.
- Do not scrape or automate live WhatsApp groups in MVP.
- Do not print full WhatsApp chat content in logs or reports.
- Preserve project separation: do not touch ProDelivery unless explicitly requested.

## Example Invocations

From a shell in the project:

```powershell
openclaw agent --agent ifrim-product --cwd "C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter" "Review the WhatsApp Delivery Counter product flow. Focus on the exact interval scan, courier alias mapping, mismatch review, and export workflow. Do not edit files."
```

```powershell
openclaw agent --agent ifrim-backend-reviewer --cwd "C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter" "Review parser/import/report logic for WhatsApp exports. Check date interval boundaries, x1/x2 quantity extraction, unknown couriers, malformed files, and duplicate imports. Do not edit files. Report severity, evidence, fix recipe, and verification command."
```

```powershell
openclaw agent --agent ifrim-security-reviewer --cwd "C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter" "Audit local file handling, zip extraction, IPC, logs, privacy, and packaged app contents. Do not edit files. Do not print full chat content."
```

If OpenClaw CLI syntax changes, run:

```powershell
openclaw --help
openclaw agent --help
```

## Current Project Priorities

1. Scaffold Electron + React + TypeScript + Vite app.
2. Implement import for `.zip` and `.txt`.
3. Parse Romanian WhatsApp export lines.
4. Add exact date/time interval picker.
5. Count `ridicat` and `livrat` with `x1`, `x2` quantities.
6. Group report by courier sender.
7. Add phone-number-to-name alias mapping.
8. Show mismatch/review rows.
9. Prepare Windows `.exe` packaging.

