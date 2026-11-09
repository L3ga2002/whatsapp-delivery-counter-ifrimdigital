# Performance Release Checkpoint - 0.3.24

- User approved performance fixes and public auto-update publication.
- User explicitly selected clearing reports/conversations at the next app startup; restaurants, schedules, courier names, aliases, settings, and external Excel exports must remain.
- Source/installer rollback backup: `.ifrim/BACKUPS/performance-0.3.23-before-fix-20261109/`.
- Runtime startup cleanup preserves a first verified archive and a verified previous-session SQLite backup before transactional cleanup. Invalid/unavailable backups skip cleanup.
- Metadata-only workspace/report snapshots, compact import JSON, bounded on-demand source context, worker import/scan/context jobs, a latest-selection context queue, and a single-instance workspace lock replace the full-history loading path.
- Preserved original physical source line offsets when rebuilding retained exports. Fixed source context for zero-error reports and stable import anchors after restaurant renames.
- Unit/regression suite: 145 passed, 9 files. TypeScript/Vite/Electron builds passed.
- Real worker performance smoke: 100 synthetic imports -> 58,441-byte snapshot; measured 2-7 ms in final runs; main event-loop heartbeat, repeated scans, and latest-selection queue passed.
- Packaged Windows executable QA passed: two restaurant schedules, independent expected 31 day/3 night orders and 15 couriers, source highlight/daily drill-down, Excel export, duplicate/corrupt imports, mutation guard, renamed restaurant, 20 view changes/typing, and restart cleanup/preserved permanent data.
- Packaged QA summed resident working sets: approximately 598 MiB for the synthetic workflow. This is a local measurement, not a claim about the client's Windows 10 PC.
- Brave verified at 1280px and 800px using the installed Brave executable and a temporary localhost preview. No page errors. Screenshots/results: `output/performance-qa/` (not distributed).
- Installer SHA256: `3355a8e6e4767f2c8620fd8996c5957c30f8a7c34023210be77ca0ef8289d9fa`.
- Existing public release channel target: `L3ga2002/whatsapp-delivery-counter-ifrimdigital-releases`, tag `v0.3.24`; publish after source commit/push using the existing verified release script.
- Codex-only implementation and independent Codex review; OpenClaw/Claude were not invoked. The client PC was not directly accessed.
