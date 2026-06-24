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
[agent/embedded] [trace:embedded-run] startup stages: runId=35186524-eaa2-49f0-a2ad-50fc4f85f530 sessionId=1380ef13-a41e-49bc-ad18-f94b0323b483 phase=attempt-dispatch totalMs=12088 stages=workspace:1ms@1ms,runtime-plugins:7500ms@7501ms,hooks:1ms@7502ms,model-resolution:4445ms@11947ms,auth:136ms@12083ms,context-engine:2ms@12085ms,attempt-workspace:1ms@12086ms,attempt-prompt:0ms@12086ms,attempt-runtime-plan:2ms@12088ms,attempt-dispatch:0ms@12088ms
[agents/tool-policy] tool policy removed 5 tool(s) via tools.profile (coding): agents_list, gateway, message, nodes, tts
[agents/tool-policy] tool policy removed 5 tool(s) via tools.profile (coding): agents_list, gateway, message, nodes, tts
[P1] Untrusted renderer can receive privileged workspace IPC  
File/line: [electron/main.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\electron\main.ts:47>) and [electron/preload.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\electron\preload.ts:39>)  
Owner/fixer: ifrim-frontend  
Evidence: `VITE_DEV_SERVER_URL` is loaded with `loadURL()` whenever the env var exists, without `app.isPackaged` or origin checks; the preload exposes `deliveryCounter`; IPC handlers return/save/delete workspace data without sender-origin validation.  
Impact: confidentiality/integrity risk for local SQLite workspace, courier data, and retained WhatsApp import data if a packaged app is launched with a poisoned env var or navigated to untrusted content.  
Fix recipe:  
1. Honor `VITE_DEV_SERVER_URL` only when `!app.isPackaged` and only for `http://127.0.0.1:3001`; otherwise always `loadFile()`. Add `will-navigate` and `setWindowOpenHandler` deny-by-default rules, and wrap IPC handlers with `event.senderFrame.url` validation.  
2. Add negative test for `VITE_DEV_SERVER_URL=https://example.com` and positive test for local dev URL in dev mode.  
3. Verification command: `rg -n "VITE_DEV_SERVER_URL|loadURL|setWindowOpenHandler|will-navigate|senderFrame" electron && npm run build`

[P1] Full WhatsApp chat content is retained in plaintext SQLite  
File/line: [src/shared/types.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\types.ts:51>), [src/shared/parser.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\src\shared\parser.ts:187>), [electron/workspace-store.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\electron\workspace-store.ts:290>)  
Owner/fixer: ifrim-backend  
Evidence: parsed models store `originalMessage`, `rawLine`, and `conversationLines`; report imports persist `JSON.stringify(reportImport.importResult)` into `import_result_json` in `workspace.sqlite`.  
Impact: data leakage risk for customer chats, courier names/phones, timestamps, and message context if `%APPDATA%`/userData, backups, or crash copies are accessed.  
Fix recipe:  
1. Store only derived counters plus minimal audit references by default; gate raw conversation context behind explicit opt-in retention, short TTL, or OS-backed encryption. Strip `rawLine`, `originalMessage`, and surrounding `conversationLines` from persisted imports unless retention is enabled.  
2. Add a negative test importing a canary message and asserting the saved DB does not contain the canary in default mode; add positive test that encrypted/opt-in retention can still reopen review context.  
3. Verification command: `rg -n "originalMessage|rawLine|conversationLines|import_result_json" src electron`

[P2] ZIP/text import has no archive bomb or size controls  
File/line: [electron/main.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\electron\main.ts:224>)  
Owner/fixer: ifrim-backend  
Evidence: selected files are fully read into memory; ZIPs are fully loaded with `JSZip.loadAsync`; every `.txt` entry is decompressed concurrently with `Promise.all(entry.async('string'))`; no selected-file, entry-count, per-entry, or total uncompressed size limits are enforced.  
Impact: availability risk from large `.txt` files, many-entry ZIPs, or compressed ZIP bombs causing memory/CPU exhaustion.  
Fix recipe:  
1. Enforce max selected file size, max ZIP entry count, max per-entry text bytes, and max total uncompressed text bytes before parsing; prefer a streaming ZIP reader with lazy entries for large archives. Normalize/reject suspicious absolute, parent, or control-character entry names even though files are not extracted.  
2. Add negative tests for oversized `.txt`, too many ZIP entries, and excessive uncompressed ZIP size; add positive test for a normal WhatsApp ZIP.  
3. Verification command: `npm test -- --run src/shared/parser.test.ts && rg -n "MAX_.*(ZIP|IMPORT|ENTRY|BYTES)|loadAsync|entry.async" electron src`

[P2] Renderer sandbox is disabled  
File/line: [electron/main.ts](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\electron\main.ts:39>)  
Owner/fixer: ifrim-frontend  
Evidence: `contextIsolation: true` and `nodeIntegration: false` are set, but `sandbox: false` disables Chromium renderer sandboxing.  
Impact: a renderer compromise has a weaker isolation boundary around the preload/IPC bridge, increasing blast radius for chat-content XSS or compromised renderer dependencies.  
Fix recipe:  
1. Set `sandbox: true`; keep preload limited to `contextBridge`/`ipcRenderer`; add a restrictive CSP for the local HTML and block external navigation.  
2. Add a negative smoke test that `window.require`, `process`, and Node globals are unavailable in the renderer; positive test that `window.deliveryCounter.getWorkspace()` still works.  
3. Verification command: `rg -n "sandbox|contextIsolation|nodeIntegration" electron/main.ts && npm run build`

[P2] Active dependency advisories affect runtime and build chain  
File/line: [package.json](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\package.json:19>) and [package.json](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\package.json:32>)  
Owner/fixer: ifrim-devops  
Evidence: `npm audit --json` reports 17 advisories total: Electron high advisories on installed `33.4.11`, electron-builder/tar high build-chain advisories, Vitest critical dev advisory, Vite dev advisories, and `npm audit --omit=dev --json` still reports `exceljs -> uuid` moderate in production dependencies.  
Impact: packaged-app compromise/tamper risk through Electron advisories, build-system archive handling risk, and runtime dependency risk during Excel export.  
Fix recipe:  
1. Upgrade Electron to a currently patched supported major, electron-builder to `26.15.3` or newer, Vitest/Vite to patched versions, and replace/upgrade Excel export dependency path so `uuid <11.1.1` is not present in production audit.  
2. Add CI gates for `npm audit --omit=dev --audit-level=moderate` and separate full dev audit; add an app launch/build smoke test after Electron major upgrade.  
3. Verification command: `npm audit --omit=dev --json && npm audit --json && npm ls electron electron-builder exceljs uuid vite vitest`

[P3] Windows release config does not show code-signing controls  
File/line: [package.json](<C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter\package.json:51>)  
Owner/fixer: ifrim-devops  
Evidence: Windows builds target `nsis` and `portable` with only `publisherName`; no signing certificate or signing options are configured in the repo.  
Impact: users cannot reliably authenticate the installer/portable executable, increasing tampering, phishing, and SmartScreen trust risk.  
Fix recipe:  
1. Configure Windows Authenticode signing via CI secret/certificate store, publish SHA-256 checksums, and consider dropping unsigned portable builds for client delivery.  
2. Add negative release check that fails when artifacts are unsigned; add positive check for a trusted signature on generated `.exe`.  
3. Verification command: `npm run dist:win; Get-AuthenticodeSignature .\\release\\*.exe | Format-List Status,SignerCertificate,Path`
⚠️ 🛠️ `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'npm audit --omit=dev --json' (in ~\OneDrive\Desktop\Ifrim Digital Proiecte\WhatsApp Delivery Counter)` failed
