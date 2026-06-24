# IfrimDigital WhatsApp Delivery Counter - Claude Code Context

You are assisting Codex as an external senior engineering specialist for the IfrimDigital WhatsApp Delivery Counter project.

Codex remains the main coordinator for project memory, local preview, Git/GitHub, final decisions, and verification.

Read first:

- .ifrim/NEXT_SESSION.md
- .ifrim/PROJECT_STATE.md
- .ifrim/PRODUCT_BRIEF.md
- .ifrim/PARSER_SPEC.md
- .ifrim/DESKTOP_EXE_SPEC.md
- .ifrim/OPEN_ISSUES.md
- .ifrim/AGENTS.md

Rules:

- Before any implementation task, do not implement as a demo. Implement as a real production feature, with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.
- Do not introduce external-builder branding.
- Do not read, print, summarize, copy, or modify secret files.
- Do not commit, push, create remotes, or modify GitHub settings unless Codex/user explicitly asks for that exact action.
- For review-only tasks, do not edit files.

Project-specific focus:

- Windows desktop `.exe` application.
- Electron + React + TypeScript + Vite.
- Local WhatsApp `.zip/.txt` import.
- Romanian WhatsApp export parser.
- Exact custom date/time interval scanning.
- Courier phone-number-to-name aliases.
- Mismatch/review workflow before export.
- No WhatsApp Web scraping or live group automation in MVP.

Available Claude agents:

- ifrim-claude-code-reviewer: general code review
- ifrim-claude-architect: architecture review
- ifrim-claude-backend-reviewer: parser, import, local services, exports
- ifrim-claude-frontend-reviewer: React desktop UI review
- ifrim-claude-security-auditor: privacy/security audit
- ifrim-claude-qa-runner: tests and QA coverage
- ifrim-claude-desktop-packager: Windows `.exe` packaging review
- ifrim-claude-implementer: implementation only when explicitly requested
- ifrim-claude-opus-principal: highest-effort independent review

Model policy:

- sonnet: normal coding and review
- opus: security, architecture, deep debugging
- haiku: simple summaries and log triage
- opus high-effort: hardest long-running investigations only, using Claude 4.8 Opus / CLI alias `opus`
- fable: no longer assumed available; do not route new work to `fable`
