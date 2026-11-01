# Building Watch Schedule

A scheduling-only version of Building Watch. It does three things:

1. Sailors sign in with Google and submit the hours they will be in the building.
2. The building manager sees who is in, sets the watch, and sees who has not submitted.
3. The manager publishes the watch to Google Calendar. Each person gets a calendar invitation.

There is no maintenance log, contractor check-in, QR form, pager, or task tracking. Those stay in the older folders, which this version does not touch.

**Demo:** with no backend connected, the app runs on sample data in the browser. Nothing reaches Google. Fictional names only: never put real names or records in this public repository.

## What it runs on

| Part | Service | Holds |
| --- | --- | --- |
| Sign-in | Google Identity Services | Nothing. The app receives only a verified email address. |
| Backend | Google Apps Script | The rules, in `backend/Code.gs` and `backend/Core.gs` |
| Data | One Google Sheet | People, submitted hours, watches, settings, audit trail |
| Watch | Google Calendar | Published watches only |
| Page | GitHub Pages | The screens, with no data |

Submitted hours stay in the Sheet and never appear on a calendar. Sailors see only their own hours and the published watch. Drafts and other people's hours are visible to admins only. The backend enforces this on every request; hiding a button is not what protects it.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page layout and styles |
| `app.js` | The screens, and the demo |
| `core.js` | The rules. Identical to `backend/Core.gs`. |
| `config.js` | Backend address and sign-in client ID |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Install as a phone app |
| `backend/Code.gs` | Backend: sign-in check, Sheet, Calendar |
| `backend/Core.gs` | Copy of `core.js` for Apps Script |
| `backend/appsscript.json` | Apps Script settings and the Google permissions requested |
| `SETUP.md` | How to connect it |

Set-up steps are in [SETUP.md](SETUP.md). GitHub does not deploy Apps Script: a change to the backend must be pasted into the script and deployed as a new version.
