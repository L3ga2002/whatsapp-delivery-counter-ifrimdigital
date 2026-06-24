# Agent Workflow - WhatsApp Delivery Counter

Codex is the coordinator.
OpenClaw agents are IfrimDigital specialist engineers.
Claude Code is an external specialist for independent review, deep audits, and selected implementation.

Detailed OpenClaw routing lives in `.ifrim/OPENCLAW.md`.

## Production Implementation Rule

Before any implementation task, read and apply this rule:

Do not implement as a demo. Implement as a real production feature, with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.

## Review Flow

1. Codex reads project memory.
2. Codex asks OpenClaw or Claude Code specialists for focused analysis when useful.
3. Review agents report findings only.
4. Fix agents implement only assigned issues.
5. QA verifies with project-specific commands.

## Project-Specific Agent Routing

- Product agent: clarify courier counting workflow, reporting rules, and client-facing UX.
- Frontend agent: build the React desktop UI, import screen, interval picker, report tables, loading/error states.
- Backend/local-services agent: implement Electron main-process file import, zip extraction, parser, persistence, and export services.
- QA agent: test parser edge cases, invalid files, interval boundaries, duplicate imports, and export correctness.
- Security/reviewer agent: check local file handling, privacy, secret leakage, app packaging, and unsafe WhatsApp automation.
- DevOps/desktop packaging agent: configure electron-builder and verify Windows `.exe` output.

## Claude Code Agents

- ifrim-claude-code-reviewer: general read-only code review.
- ifrim-claude-architect: Electron/app architecture review.
- ifrim-claude-backend-reviewer: parser, zip import, local services, exports.
- ifrim-claude-frontend-reviewer: React desktop UI review.
- ifrim-claude-security-auditor: local file, privacy, IPC, and packaging security audit.
- ifrim-claude-qa-runner: test strategy and verification.
- ifrim-claude-desktop-packager: Windows `.exe` packaging review.
- ifrim-claude-implementer: implementation only when Codex/user explicitly requests Claude implementation.
- ifrim-claude-opus-principal: highest-effort external review for hard investigations, using Claude 4.8 Opus / CLI alias `opus`.

Run with:

```powershell
.\tools\claude-review.ps1 -Profile quick
.\tools\claude-review.ps1 -Profile security
.\tools\claude-review.ps1 -Profile parser
.\tools\claude-review.ps1 -Profile desktop
.\tools\claude-review.ps1 -Profile opus
```

## Current First Task For Implementer Agents

Scaffold a production-oriented Electron + React + TypeScript app and implement the first vertical slice:

- import `.zip` and `.txt`
- parse Romanian WhatsApp export lines
- select exact date/time interval
- count `ridicat` and `livrat`
- extract `x1`, `x2` quantities
- group by courier sender
- support alias mapping placeholder
- show mismatches/review rows
- keep preview on `http://127.0.0.1:3001`

## Required Finding Shape

- severity
- file/line
- evidence
- impact
- owner/fixer agent
- fix recipe
- verification command
