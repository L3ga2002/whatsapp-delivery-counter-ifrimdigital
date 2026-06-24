# OpenClaw report: ifrim-security-reviewer

Generated: 2026-06-24T00:48:31.7778026+03:00


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
Review complete. I did not edit source files, commit, push, or touch ProDelivery. Caveat: I ran `npm run build`, which regenerated ignored `dist/` and `dist-electron/` outputs; tests/build passed.

No P0/P1 findings found.

[P2] Full WhatsApp-derived conversations are retained in local SQLite
File/line: `src/shared/parser.ts:188`, `src/shared/parser.ts:1187`, `src/shared/parser.ts:1280`, `electron/workspace-store.ts:295`, `electron/workspace-store.ts:537`
Owner: ifrim-backend
Evidence: imports keep `conversationLines`, `originalMessage`, `rawLine`, sender data, and then persist the full `importResult` JSON into `workspace.sqlite` under Electron `userData`.
Impact: confidentiality and privacy risk if the Windows profile, backups, support bundle, malware, or another local process accesses the DB.
Fix recipe:
1. Store only normalized report fields by default; keep raw messages only behind an explicit ÔÇťretain source text for reviewÔÇŁ setting with retention/delete controls, or encrypt the DB with a Windows DPAPI-backed key.
2. Add a negative test importing a unique canary phrase and asserting it is not present in persisted DB bytes when retention is off; add a positive test that review rows still work.
3. Verification: `Select-String -Path "$env:APPDATA\whatsapp-delivery-counter-ifrimdigital\workspace.sqlite" -Pattern "UNIQUE_PRIVACY_CANARY" -SimpleMatch -Quiet` should return `False`.

[P2] ZIP/TXT size limits are enforced after full reads/decompression allocation
File/line: `electron/main.ts:306`, `electron/main.ts:323`, `electron/main.ts:347`, `electron/main.ts:352`
Owner: ifrim-backend
Evidence: `fs.readFile(filePath)` loads the entire selected file before the TXT/ZIP byte checks, and ZIP entries are decompressed with `entry.async('string')` before post-decompression byte validation.
Impact: availability risk; a user-selected huge file or high-ratio ZIP can spike memory/CPU and crash the desktop app.
Fix recipe:
1. `stat` files before reading, reject over-limit paths before allocation, and replace JSZip full-string decompression with bounded streaming or a ZIP parser that validates uncompressed size before extraction.
2. Add negative tests for oversized TXT, oversized ZIP, too many entries, path traversal, and a compressed entry that exceeds the decompressed limit.
3. Verification: `npm test -- src/shared/parser.test.ts` plus a new Electron import-limit test fixture.

[P2] Packaged runtime uses vulnerable/stale Electron
File/line: `package.json:32`
Owner: ifrim-devops
Evidence: package pins Electron `^33.2.1`; installed version is `33.4.11`. `npm audit --json` reports high-severity Electron advisories and recommends Electron `42.5.0`.
Impact: packaged app integrity/availability risk, including Electron runtime CVEs such as use-after-free and ASAR integrity bypass advisories.
Fix recipe:
1. Upgrade Electron to the current supported stable line, upgrade `electron-builder`, rebuild, and smoke test import/export.
2. Add CI gate for `npm audit` including dev dependencies that become packaged runtime dependencies.
3. Verification: `npm audit --json`, `npm outdated electron electron-builder`, `npm run build`.

[P3] Windows package has no repo-enforced signing/integrity policy
File/line: `package.json:39`, `package.json:51`
Owner: ifrim-devops
Evidence: builder config produces `nsis` and `portable` Windows targets with `publisherName`, but no signing certificate, signing validation, hash manifest, or release verification policy is configured in repo.
Impact: packaged app tampering and trust risk; users may run unsigned or unverifiable binaries that handle private WhatsApp data.
Fix recipe:
1. Configure Windows code signing in the release pipeline and publish SHA-256 checksums; consider dropping portable builds unless signed and checksum-published.
2. Add a release test that fails when artifacts are unsigned.
3. Verification: `Get-AuthenticodeSignature .\release\*.exe` and `Get-FileHash .\release\*.exe -Algorithm SHA256`.

[P3] Renderer lacks a Content Security Policy while exposing privileged IPC API
File/line: `index.html:3`, `index.html:10`, `electron/preload.ts:20`, `electron/preload.ts:41`
Owner: ifrim-frontend
Evidence: `index.html` has no CSP meta tag; preload exposes `window.deliveryCounter` with workspace/import/report APIs to any script running in the trusted renderer.
Impact: defense-in-depth gap. I did not find an obvious XSS path because React rendering escapes text, but any future renderer injection could read workspace data and invoke privileged IPC.
Fix recipe:
1. Add a production CSP such as `default-src 'self'; script-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`, with a dev-only variant if Vite needs it.
2. Add a regression test or built-artifact check that `dist/index.html` contains CSP.
3. Verification: `npm run build` then inspect `dist/index.html` for the CSP meta tag.

Verification run:
`npm test` passed: 39 tests.
`npm run build` passed.
`.ifrim/*.log` scan found 0 matches for obvious raw chat/message fields or Romanian delivery keywords.
ÔÜá´ŞĆ ­čŤá´ŞĆ `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'Get-ÔÇŽ:LOCALAPPDATA | Select-Object FullName,Length,LastWriteTime' (in ~\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter)` failed
