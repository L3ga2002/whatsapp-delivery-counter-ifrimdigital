# Desktop EXE Spec - WhatsApp Delivery Counter

## Requirement

The app must be deliverable to the client as a Windows desktop application.

The target artifact is:

- installer `.exe`, preferred for client distribution
- or portable `.exe`, if simpler for early validation

## Preferred Stack

- Electron for native Windows shell
- React + TypeScript for UI
- Vite for local development preview
- Electron main process for:
  - file import
  - zip extraction
  - local persistence
  - export generation
  - multi-import restaurant metadata
- Renderer process for:
  - dashboard
  - calendar interval selection
  - courier mapping
  - report review

## Local Storage

Store non-secret user data locally:

- courier aliases
- restaurant aliases / import-to-restaurant mappings
- import history metadata
- last selected interval
- app settings

Do not store WhatsApp chats in plain project files by default. Imported chat content should either be:

- processed in memory
- stored in app data only after user consent
- exportable/deletable by the user

For review navigation, imported message metadata and source context may need to be stored locally in app data, with delete/clear controls.

## Packaging

Planned package tool:

- `electron-builder`

Expected commands later:

```powershell
npm run dev
npm run electron:dev
npm run build
npm run dist:win
```

## Quality Gates

Before any `.exe` delivery:

- parser tests pass
- import invalid file test passes
- duplicate upload handling works
- scan interval boundaries tested
- multi-restaurant import tested
- restaurant/day/courier grouping tested
- delivery-time pairing tested
- export opens correctly
- Windows app starts without terminal
- no secrets included
- app name and publisher branding are IfrimDigital/client-safe
