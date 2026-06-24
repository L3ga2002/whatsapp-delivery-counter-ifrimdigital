# WhatsApp Delivery Counter - IfrimDigital

Windows desktop app for counting delivery activity from exported WhatsApp group chats.

## Product Goal

The client currently counts delivery messages manually from many WhatsApp groups.
This app keeps a local workspace with restaurants, couriers, saved reports, and imported WhatsApp `.zip` or `.txt` exports. It scans a selected date/time interval, extracts courier activity, and produces flexible reports for payment and verification.

## Core Workflow

1. Create or open a saved report.
2. Set the exact scan interval:
   - start date and time
   - end date and time
3. Import restaurant WhatsApp exports or the separate work-hours/pontaj chat.
4. Verify detected import period and imported message counts.
5. Scan only messages inside the saved interval.
6. Review tabbed results by courier, restaurant, day, night/exterior, delivery time, work hours, and review.
7. Export the full report, a restaurant report, or review-only Excel.

## Desktop Requirement

The app must be buildable as a Windows `.exe` that can be sent to the client.

Preferred stack:

- Electron
- React
- TypeScript
- Vite
- Local parser/service in Electron main process
- Local SQLite persistence in AppData
- Excel export with multiple report scopes
- Windows packaging with electron-builder

## Public Auto-Update Channel

The source repository can stay private. Installed clients update from a separate public GitHub Releases repository that contains only release artifacts, not source code.

Client setup:

1. Install the current `.exe`.
2. Open `Setari`.
3. Use `Verifica update`, `Descarca update`, then `Instaleaza si reporneste`.
4. No GitHub account or token is required on the client computer.

Release build:

```powershell
npm run verify:release
npm run publish:github
```

## Production Rule

Do not implement as a demo. Implement real production behavior with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.
