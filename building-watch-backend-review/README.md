# Building Watch — backend review

This folder is reserved for the Google Apps Script source used by the Star Trek-themed Building Watch demonstration.

**Status: backend source pending upload.** The correct `Building-Watch-Star-Trek-Live-Calendar-QR-v2.zip` package has been located and verified to contain `Code.gs`, `Core.gs`, and `appsscript.json`. The review folder should contain only those three source files and this README.

## What belongs here
- `Code.gs` — actual deployed API and authorization code
- `Core.gs` — actual deployed shared logic
- `appsscript.json` — manifest, OAuth scopes and services

## Before publishing
Use the three backend files from the verified v2 ZIP, without frontend duplicates or old setup instructions. The source package was checked for common embedded secrets. Confirm no live credentials or personal information were subsequently added before publication.

## Architecture
The frontend is served by GitHub Pages at `building-watch-trek/`. The backend runs independently as a Google Apps Script web app. Files committed here are a **review copy**, not an automatic deployment.

## Review scope
Check token verification, per-operation authorization, Admin/Member permissions, invitation flow, public endpoint access, Google Sheets/Calendar scopes, logging, and data handling.

The Star Trek demo uses fictional records and is not approved for operational Navy personnel data.

## Google Sheets used by the test

These are the five fictional-data Google Sheets. Links are public in this README, **but the Sheets remain private** unless the owner grants access. Reviewers can request Viewer permission; do not change sharing to Anyone with the link.

- [01 Availability — Star Trek Demo](https://docs.google.com/spreadsheets/d/1KJk8VWF2sgV4iMXSXTfp2LCgVg4Ad0aOIEOU8KqIax8/edit)
- [02 Watch Schedule — Star Trek Demo](https://docs.google.com/spreadsheets/d/14YYqw5W8HIg-KCr9mxIWq3FIqPpEXqLsIj74-ioizbQ/edit)
- [03 Maintenance Workers — Star Trek Demo](https://docs.google.com/spreadsheets/d/12PM8tTBRM3vJs-jb__-Q2_HDboYm_Vs2e86tcERZC8s/edit)
- [04 Task Definitions — Star Trek Demo](https://docs.google.com/spreadsheets/d/1uYn00bp1XhtO-iv5rrjSUKxFBwSwtSO8TAt6e9dU9pM/edit)
- [05 Task Activity — Star Trek Demo](https://docs.google.com/spreadsheets/d/12BGPkVsYDbgvPJiRAWNVkpKEkCvM8U7An4heEJ1r8QM/edit)

[Google Drive folder containing all five Sheets](https://drive.google.com/drive/folders/1TDQyWmBbe-9Wk_dZ6DFQFcZcad5hw-C-)

The reviewer should compare the actual Sheet schema against the deployed Apps Script configuration once its source has been exported.
