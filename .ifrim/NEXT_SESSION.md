# Next Session - WhatsApp Delivery Counter

## Read First

- Central bootstrap:
  - `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\THREAD_BOOTSTRAP.md`
  - `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\AGENT_ROUTING_PROTOCOL.md`
- .ifrim/PROJECT_STATE.md
- .ifrim/PRODUCT_BRIEF.md
- .ifrim/PARSER_SPEC.md
- .ifrim/DESKTOP_EXE_SPEC.md
- .ifrim/OPEN_ISSUES.md
- .ifrim/PREVIEW.md
- .ifrim/AGENTS.md
- .ifrim/OPENCLAW.md
- .ifrim/THREAD_PROMPT.md
- README.md
- CLAUDE.md

## Current Focus

- Stabilize and test the v0.3 guided report workflow with real client exports.
- The app now has local SQLite memory plus a client-friendly 5-step flow: interval, imports, verification, scan, results/export.
- Next practical focus: validate the guided flow end-to-end with 3+ restaurants, polish copy/layout based on Catalin/client feedback, and harden edge cases found in real WhatsApp conversations.

## Product Non-Negotiables

- The app must be buildable as a Windows `.exe`.
- The primary scan mode is custom calendar interval, not automatic last 7 days.
- The user must select exact `from` and `to` date/time.
- The scan must count only messages inside that selected interval.
- The app must extract courier identity from the WhatsApp sender and support phone-number-to-name aliases.
- Restaurants, couriers, aliases, reports, imports, and settings must persist locally in AppData.
- Export must stay flexible: full report, restaurant-only, selected restaurants, global couriers, review-only, or work-hours-only.
- Do not automate or scrape live WhatsApp groups in MVP.

## Claude Code Agents

- Full Claude Code agent set is configured in `.claude/agents/`.
- Use `tools/claude-review.ps1` profiles: `quick`, `security`, `architect`, `frontend`, `parser`, `qa`, `desktop`, `implementer`, `opus`.
- `fable` remains only as a legacy alias to `opus` for old commands.
- `implementer` is allowed only when Codex/user explicitly asks Claude to implement.

## Agent Routing Requirement

- Before non-trivial implementation/review/debugging, state the routing decision:
  - Codex only with reason
  - OpenClaw reviewer/implementation agent
  - Claude Code review/audit profile
  - hybrid OpenClaw + Claude
- Do not silently skip OpenClaw/Claude for parser, privacy/security, QA, desktop packaging, architecture, or cross-module work.

## Required Implementation Rule

- Before implementation, do not build demo-only behavior. Build real production features with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and no broken existing flows.

## Safe First Commands

git status --short --branch
npm install
npm test
npm run build
npm run dev
