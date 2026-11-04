# Starfleet Scheduling — Building Watch

This is a scheduling-only frontend rebuilt from the complete **previous Star Trek Building Watch** code, rather than a separate scheduling engine.

- Live: https://richarddemy.github.io/helloWorld/building-watch-scheduling/
- Fictional demo: https://richarddemy.github.io/helloWorld/building-watch-scheduling/?demo
- Existing Google Apps Script URL and OAuth client ID: unchanged from the prior Star Trek version (`config.js`).
- Existing `core.js`: byte-for-byte copy of the prior working edition.
- Existing backend and Google Sheets: no deployment or settings changes.
- Availability, duty watch assignments, admin publishing, personal calendar overlays and existing authentication all use the original functions.
- Maintenance log, service requests, facilities assignments and worker alerts are hidden or disabled in this frontend, not deleted from the backend.

The live application requires the configured Google account and an accessible working Apps Script backend. The demo never touches the backend, stores fictional changes in the local browser, and has a separate cache and storage key from other versions.

**Security:** This is still a public GitHub Pages frontend. Do not use real operational Navy personnel or watch information until command cybersecurity authorization and the Google service authorization boundary have been established.
