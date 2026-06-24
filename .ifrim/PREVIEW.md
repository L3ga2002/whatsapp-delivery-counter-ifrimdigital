# Preview - WhatsApp Delivery Counter

## Live Preview Rule

For app/frontend work, keep local preview available whenever practical.

Workflow:

1. Start or verify preview before user-facing frontend changes.
2. Use the URLs below and the reserved ports from .ifrim-system/PORTS.md.
3. After UI changes, open/check the affected route in the browser.
4. Tell Catalin the exact URL tested.
5. If preview cannot run, record the blocker here or in OPEN_ISSUES.md.

- Frontend: http://127.0.0.1:3001
- Backend API: No separate HTTP backend in production; Electron main process/local services

## Commands

Expected after scaffold:

```powershell
npm install
npm run dev
npm run electron:dev
npm run build
npm run dist:win
```

## Notes

- Browser preview should use `http://127.0.0.1:3001`.
- Native preview should launch Electron.
- Before final Windows delivery, verify the packaged `.exe` starts without a development terminal.
- 2026-06-12: Verified Vite preview at `http://127.0.0.1:3001`; page rendered with no browser console errors. Browser-only import shows the expected Electron import notice.
- 2026-06-12: Electron preview should be used for import/export checks because file import and `.xlsx` download depend on desktop runtime behavior.
- 2026-06-13: `npm run electron:dev` now starts Vite automatically through `concurrently` and waits with `wait-on`; no separate `npm run dev` command is required for desktop preview.
- 2026-06-14: After importing a chat, verify the interval remains user-selected/empty and the UI displays only the exact interval chosen in the date-time fields.
