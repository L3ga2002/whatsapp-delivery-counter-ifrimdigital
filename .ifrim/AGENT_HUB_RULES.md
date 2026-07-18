# WhatsApp Delivery Counter Agent Hub Rules

This project participates in the IfrimDigital Agent Hub system.

## Priority Context

WhatsApp Delivery Counter is a Windows desktop app for importing exported WhatsApp group chats and counting courier delivery activity for exact date/time intervals.

Core non-negotiable rule:

- do not use "last 7 days" as the only counting logic
- the primary workflow must be user-selected interval by date and time

## Required Before Non-Trivial Work

Read:

- central `.ifrim-system/AGENT_HUB.md`
- central `.ifrim-system/REGRESSION_QA.md`
- `.ifrim/NEXT_SESSION.md`
- `.ifrim/PROJECT_STATE.md`
- `.ifrim/PRODUCT_BRIEF.md` if present
- `.ifrim/PARSER_SPEC.md` if present
- `.ifrim/DESKTOP_EXE_SPEC.md` if present
- `.ifrim/PREVIEW.md`
- `.ifrim/AGENTS.md`
- `.ifrim/OPENCLAW.md`

## Task Gates

Classify each task:

- `parser_core`
- `desktop_ui`
- `export_report`
- `packaging_exe`
- `data_safety`
- `unclear_scope`

Ask Catalin before destructive cleanup, broad parser rewrites, or packaging/distribution changes.

## Default Routing

- parser/data logic: owner `ifrim-backend`, reviewer `ifrim-backend-reviewer`, QA `ifrim-qa`
- desktop UI: owner `ifrim-frontend`, reviewer `ifrim-frontend-reviewer`, QA `ifrim-qa`
- Windows packaging: owner `ifrim-devops`, reviewer `ifrim-devops-reviewer`, QA `ifrim-qa`
- data/privacy risk: reviewer `ifrim-security-reviewer`

## Regression QA Minimum

For important changes, verify:

- import valid `.zip`
- import valid `.txt`
- invalid/corrupt file handling
- custom interval start/end date and time
- counts by courier
- quantity markers such as `x1`, `x2`
- unclear/mismatch rows
- alias mapping
- export report if affected
- duplicate import/request protection
- loading/error/empty states
- readable desktop UI

## Snapshot Rule

When Catalin likes a version, save a checkpoint with:

- git state
- app version/build state
- sample file type tested
- interval tested
- export status
- known limitations
