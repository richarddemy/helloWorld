# Building Watch — Application and Technical Overview

Building Watch is a web-based facilities scheduling and operations application. It brings staff availability, watch assignments, building maintenance activity, task requests, and reporting into one interface that can be used from a desktop computer or mobile phone.

**This is a running application, not a static mockup.** Its current data uses fictional Star Trek names, organizations, and work orders so that the system can be demonstrated and reviewed without using actual personnel or visitor records. The application code connects to a deployed Google Apps Script backend and Google Sheets. Calendar publishing and email functions are implemented; individual integrations should be validated during acceptance testing.

## Application

**Live application:** https://richarddemy.github.io/helloWorld/building-watch-trek/

**Frontend source:** [building-watch-trek](../building-watch-trek/)

The application supports:

- **Google account sign-in.** Users authenticate with Google; the application does not collect or manage passwords.
- **User administration.** Administrators manage authorized users, invitations, and the two permission levels: **Admin** and **Member**. Members are facilities personnel; administrators configure and manage the system.
- **Availability scheduling.** Members mark available times on a weekly calendar. The interface can display other Google Calendar commitments to help users avoid conflicts.
- **Watch scheduling.** Administrators review availability, create assignments, and manage the watch schedule.
- **Calendar publication.** An administrator selects a destination Google Calendar, reviews unpublished assignments, and explicitly publishes them as events. Availability entries alone do not create calendar events.
- **Maintenance worker records.** The application records outside-worker arrivals, work performed, and departures, including follow-up details.
- **QR-based worker check-in.** A Google Form can be created for worker arrival information. Where a worker provides an email address and consents, the backend can send a one-time sign-out link. Worker-reported departure and staff acknowledgment are tracked separately.
- **Maintenance requests.** Users can record contractor/maintenance issues, priorities, work-order references, status, and task activity.\n- **Crew assignments.** Supervisors assign facility improvement projects to one or more crew members; assigned personnel submit completion for supervisor approval. This is separate from contractor maintenance.
- **Reporting and export.** Records can be reviewed and exported for operational reporting.

The fictional names and sample records are demonstration content; the scheduling, data-handling, and administrative functions are application features.

## Technical architecture

| Component | Implementation | Purpose |
| --- | --- | --- |
| User interface | HTML, CSS, JavaScript | Responsive browser application, including installable progressive-web-app assets |
| Frontend hosting | GitHub Pages | Serves the application and static assets over HTTPS |
| Authentication | Google Identity Services | Provides Google ID tokens for sign-in |
| Backend API | Google Apps Script Web App | Processes authenticated requests, enforces roles, and coordinates Google services |
| Persistent storage | Five Google Sheets | Stores people, availability, schedules, maintenance logs, requests, activity, settings, and audit information |
| Calendar integration | Google Calendar via Apps Script | Reads calendar information and publishes selected watch assignments |
| Email | Google Mail services via Apps Script | Sends configured invitations, notifications, and consent-based worker sign-out links |
| Worker intake | Google Forms / Apps Script trigger | Captures QR-form submissions into the maintenance log |

The browser calls the Apps Script endpoint using HTTPS and sends a Google ID token with API requests. The backend validates the token against Google's token-information endpoint, checks its configured OAuth client ID, and uses the verified email address to identify the user. Authorization is enforced by backend application logic, not simply by hiding controls in the interface.

The Apps Script Web App runs with its deployment account's authorized Google service permissions. The five Sheets are the persistent application data store; GitHub is **not** the database. Google Drive sharing permissions remain separate from application permissions.

## Data flow

1. A user opens Building Watch and signs in with Google.
2. The frontend sends an authenticated request to the Apps Script API.
3. The backend validates identity, determines the user's role, and handles the requested operation.
4. The backend reads or updates the appropriate Google Sheets.
5. Where applicable, the backend calls Google Calendar, email, or Google Forms services.
6. The application displays the result; administrators can review schedules, records, and reports.

## Roles and access

**Admin** users manage people, scheduling, calendar selection and publication, and administrative settings. **Member** users access the facilities functions permitted by the backend. Adding someone to a Google Sheet's sharing list does not automatically make that person an authorized application user.

The public GitHub repository allows source review. It does **not** grant access to the private Google Sheets, the Google Cloud project, or the deployed Apps Script editor.

## Source code for review

The frontend lives in [`building-watch-trek/`](../building-watch-trek/). This review directory is intended to hold the matching backend source:

- `Code.gs` — Apps Script API endpoints, Google integrations, authorization and persistence
- `Core.gs` — shared business rules and data operations
- `appsscript.json` — Apps Script manifest and requested OAuth scopes
- `README.md` — this technical overview

The backend source in GitHub is a review copy. Publishing changes to GitHub does not automatically update the deployed Apps Script Web App. Reviewers should confirm that the checked-in backend version matches the deployed version before drawing conclusions about production behavior.

## Google Sheets

The application uses five spreadsheets. Their links are provided for review; **the links do not grant access**. The owner can grant individual reviewers Viewer permission.

| Spreadsheet | Purpose |
| --- | --- |
| [Availability](https://docs.google.com/spreadsheets/d/1KJk8VWF2sgV4iMXSXTfp2LCgVg4Ad0aOIEOU8KqIax8/edit) | Submitted staff availability |
| [Watch Schedule](https://docs.google.com/spreadsheets/d/14YYqw5W8HIg-KCr9mxIWq3FIqPpEXqLsIj74-ioizbQ/edit) | People, watch assignments, settings, and audit records |
| [Maintenance Workers](https://docs.google.com/spreadsheets/d/12PM8tTBRM3vJs-jb__-Q2_HDboYm_Vs2e86tcERZC8s/edit) | Visitor and worker activity log |
| [Task Definitions](https://docs.google.com/spreadsheets/d/1uYn00bp1XhtO-iv5rrjSUKxFBwSwtSO8TAt6e9dU9pM/edit) | Facilities issues and requests |
| [Task Activity](https://docs.google.com/spreadsheets/d/12BGPkVsYDbgvPJiRAWNVkpKEkCvM8U7An4heEJ1r8QM/edit) | Recorded request and task activity |

[Open the Google Drive folder containing all five Sheets](https://drive.google.com/drive/folders/1TDQyWmBbe-9Wk_dZ6DFQFcZcad5hw-C-)

## Suggested technical review

Review the implementation of Google ID token validation, role-based authorization on each API action, the publicly reachable Apps Script endpoint, deployment-account privileges, Google service scopes, calendar publishing and duplicate-event handling, invitation and email behavior, worker sign-out token handling, audit records, data retention, and error handling.

For functional verification, test member onboarding, administrator restrictions, availability persistence, watch assignment creation, explicit calendar publishing, maintenance check-in and sign-out, and report exports. The current fictional dataset permits these checks without substituting real personnel information.


## Crew assignments — staged backend update (October 2026)

Two new tabs have been created in the existing Star Trek demonstration spreadsheets:

- [Crew Assignments](https://docs.google.com/spreadsheets/d/1uYn00bp1XhtO-iv5rrjSUKxFBwSwtSO8TAt6e9dU9pM/edit) in Task Definitions. Stores projects, shared assignee IDs, due dates, statuses, submission, and approval metadata.
- [Crew Assignment Activity](https://docs.google.com/spreadsheets/d/12BGPkVsYDbgvPJiRAWNVkpKEkCvM8U7An4heEJ1r8QM/edit) in Task Activity. Stores append-only progress and review events.

Frontend code is committed and the in-browser demo uses the new assignment workflow. Backend review source is staged here as `Code.gs`, `Core.gs`, and `appsscript.json`. **This repository does not automatically deploy Google Apps Script.** Before using crew assignments against the live backend, merge the staged changes with the current deployed Apps Script source, verify the data-source mapping and permissions, deploy a new Web App version, and test authorization with both Admin and Member accounts. The staged `Code.gs` is based on the earlier single-spreadsheet backend and is not a guaranteed drop-in replacement for the current five-spreadsheet deployment. Do not overwrite the current live `Code.gs` without merging its integrations.

Backend rules: Admin creates, edits, reassigns, approves, or returns work. A Member receives only assignments containing their person ID and can add progress or submit for review. A submission does not close the assignment; only an Admin approval does. Maintenance requests and worker check-in remain separate. The old recurring watch checklist is no longer displayed in the frontend.
