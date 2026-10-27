# Building Watch — backend review

This folder is reserved for the Google Apps Script source used by the Star Trek-themed Building Watch demonstration.

**Status: backend source not yet uploaded.** The earlier ZIP archive available for review contains a different, older single-sheet implementation, while the deployed Star Trek test uses five Sheets. Publishing the older code as if it were the deployed backend would mislead IT reviewers.

## What belongs here
- `Code.gs` — actual deployed API and authorization code
- `Core.gs` — actual deployed shared logic
- `appsscript.json` — manifest, OAuth scopes and services

## Before publishing
Export the three files from the current Apps Script project; remove live Sheet/Calendar IDs, personal email addresses, private URLs, credentials, tokens and secrets. Check the full Git diff before committing.

## Architecture
The frontend is served by GitHub Pages at `building-watch-trek/`. The backend runs independently as a Google Apps Script web app. Files committed here are a **review copy**, not an automatic deployment.

## Review scope
Check token verification, per-operation authorization, Admin/Member permissions, invitation flow, public endpoint access, Google Sheets/Calendar scopes, logging, and data handling.

The Star Trek demo uses fictional records and is not approved for operational Navy personnel data.

## Google Sheets used by the test

The deployed Star Trek test uses **five Google Sheets** as its data store. Their actual links are intentionally **not published in this public repository**: sheet IDs identify live resources, and access is controlled separately by Google Drive sharing permissions.

For authorized IT reviewers, provide the five sheet URLs through an approved private channel, with Viewer access to fictional test data only. Do not grant Editor access or share live operational records. A link alone does not grant access to a private Sheet.

| Test Sheet | Review link |
| --- | --- |
| Sheet 1 | Share privately with authorized reviewer |
| Sheet 2 | Share privately with authorized reviewer |
| Sheet 3 | Share privately with authorized reviewer |
| Sheet 4 | Share privately with authorized reviewer |
| Sheet 5 | Share privately with authorized reviewer |

The reviewer should compare the actual Sheet schema against the deployed Apps Script configuration once its source has been exported.
