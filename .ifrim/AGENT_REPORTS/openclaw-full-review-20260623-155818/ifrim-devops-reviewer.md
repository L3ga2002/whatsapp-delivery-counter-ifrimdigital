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
gateway connect failed: Error: gateway closed (1000): 
Gateway agent connection closed during handshake; retrying in 1000ms before embedded fallback.
gateway connect failed: Error: gateway request timeout for connect
EMBEDDED FALLBACK: Gateway agent failed; running embedded agent: GatewayTransportError: gateway closed (1006 abnormal closure (no close frame)): no close reason
Gateway target: ws://127.0.0.1:18789
Source: local loopback
Config: C:\Users\mihai\.openclaw\openclaw.json
Bind: loopback
System.Management.Automation.RemoteException
Possible causes:
- Gateway not yet ready to accept connections (retry after a moment)
- TLS mismatch (connecting with ws:// to a wss:// gateway, or vice versa)
- Gateway crashed or was terminated unexpectedly
Run `openclaw doctor` for diagnostics.
[plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load: codex (C:\Users\mihai\.openclaw\npm\projects\openclaw-codex-8902d781d4\node_modules\@openclaw\codex\dist\index.js). Set plugins.allow to explicit trusted ids.
[agent/embedded] [trace:embedded-run] startup stages: runId=85cfdabf-581b-4bca-89db-dc355857d664 sessionId=4396194c-ad91-4637-b571-a384bd2c9b3e phase=attempt-dispatch totalMs=11868 stages=workspace:2ms@2ms,runtime-plugins:7528ms@7530ms,hooks:0ms@7530ms,model-resolution:4022ms@11552ms,auth:309ms@11861ms,context-engine:3ms@11864ms,attempt-workspace:1ms@11865ms,attempt-prompt:0ms@11865ms,attempt-runtime-plan:3ms@11868ms,attempt-dispatch:0ms@11868ms
[agents/tool-policy] tool policy removed 5 tool(s) via tools.profile (coding): agents_list, gateway, message, nodes, tts
[agents/tool-policy] tool policy removed 5 tool(s) via tools.profile (coding): agents_list, gateway, message, nodes, tts
[P2] Electron dev startup can attach to the wrong process on port 3001  
File/line: `package.json:8-10`, `vite.config.mts:6-14`, `.ifrim/PREVIEW.md:15`  
Owner/Fixer: `ifrim-devops`  
Evidence: `electron:dev:app` runs `wait-on http://127.0.0.1:3001` and then launches Electron with that URL. Because port `3001` is fixed and `wait-on` only checks that something answers, a stale/unrelated service on `3001` can satisfy the wait even if Vite failed to start.  
Impact: desktop preview can open the wrong app or pass a smoke check against a stale server.  
Fix recipe:  
1. Add a preflight script that fails if `127.0.0.1:3001` is already owned before starting Vite, or record/verify the Vite PID.  
2. Change the wait target to a Vite-specific resource such as `http-get://127.0.0.1:3001/@vite/client`.  
3. Add a `dev:stop` path that only stops the recorded project-owned process.  
Verification command:  
```powershell
$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'),3001); $l.Start(); try { npm run electron:dev } finally { $l.Stop() }
```

[P2] Built Vite preview is configured but not exposed as an npm script  
File/line: `vite.config.mts:11-14`, `package.json:7-14`, `.ifrim/PREVIEW.md:22-28`  
Owner/Fixer: `ifrim-devops | ifrim-frontend`  
Evidence: Vite has a `preview` config for `127.0.0.1:3001`, but the npm scripts only expose `dev`, `electron:dev`, `build`, `test`, and `dist:win`. The documented commands also omit `npm run preview`.  
Impact: reviewers can validate the dev server while missing static-build asset/base failures until Electron packaging.  
Fix recipe:  
1. Add `"preview": "vite preview --host 127.0.0.1 --port 3001 --strictPort"`.  
2. Document it in `.ifrim/PREVIEW.md` as the browser smoke check after `npm run build`.  
3. Keep Electron runtime checks under `npm run electron:dev` because imports/exports need desktop APIs.  
Verification command:  
```powershell
npm run build; npm run preview
```

[P2] Windows `.exe` readiness lacks signing/icon configuration  
File/line: `package.json:51-61`, `README.md:22-35`, `.ifrim/DESKTOP_EXE_SPEC.md:64-76`  
Owner/Fixer: `ifrim-devops`  
Evidence: the Windows builder config defines `nsis` and `portable` targets plus `publisherName`, but no `icon`, certificate signing config, signing env documentation, or explicit unsigned-release gate.  
Impact: client-delivered installers are likely unsigned/generic, triggering SmartScreen trust friction and weaker brand readiness.  
Fix recipe:  
1. Add a Windows `.ico` under build resources and configure `build.icon`.  
2. Add signing via `CSC_LINK`/`CSC_KEY_PASSWORD` or `win.certificateSubjectName`, or explicitly document “unsigned validation build only”.  
3. Add `artifactName` so installer/portable names include product, version, and arch.  
Verification command:  
```powershell
npm run dist:win -- --publish never; Get-AuthenticodeSignature .\release\*.exe | Format-Table Path,Status,SignerCertificate
```

[P2] Release/update path is not defined and app version is stale against project state  
File/line: `package.json:3`, `package.json:39-61`, `.ifrim/PROJECT_STATE.md:9`  
Owner/Fixer: `ifrim-devops`  
Evidence: `package.json` is still `0.1.0`, while project state says `v0.3 guided report workflow implemented`. The builder config has no `publish` provider, no update metadata policy, and dependencies do not include `electron-updater`.  
Impact: shipped `.exe` builds cannot be reliably identified, upgraded, rolled back, or matched to client bug reports.  
Fix recipe:  
1. Bump `package.json` version per release, matching `.ifrim/PROJECT_STATE.md`/changelog.  
2. Choose the release model: manual download with hashes and rollback notes, or auto-update with `electron-updater` plus `publish` config.  
3. For manual releases, add a release checklist that records artifact names, hashes, version, and rollback artifact.  
Verification command:  
```powershell
node -p "require('./package.json').version"; npm run dist:win -- --publish never; Get-FileHash .\release\*.exe
```

[P3] Packaging logs are not produced by a repeatable packaging command  
File/line: `package.json:14`, `.gitignore:16-23`, `.ifrim/electron-v02-smoke.log:70-72`, `.ifrim/electron-v03-ux.log:22-24`  
Owner/Fixer: `ifrim-devops | ifrim-qa`  
Evidence: `dist:win` runs without log capture, while existing smoke logs are ad hoc ignored `.ifrim/*.log` files. Current Electron dev logs also show termination noise such as Vite exiting with code `1`/`1073807364` after Electron shutdown.  
Impact: packaging failures and smoke results are hard to compare across releases, and normal shutdown can look like a failed preview.  
Fix recipe:  
1. Add a `dist:win:log` script that writes stdout/stderr to `.ifrim/package-logs/<timestamp>-dist-win.log`.  
2. Add a smoke-log convention for installer/portable launch results.  
3. Adjust Electron dev shutdown handling or log notes so normal app close is not triaged as a failed startup.  
Verification command:  
```powershell
npm run dist:win:log; Get-ChildItem .ifrim\package-logs -Filter "*dist-win*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
```
