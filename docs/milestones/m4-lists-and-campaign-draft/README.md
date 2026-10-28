# M4 upload, lists, campaign draft and summary

## Business outcome

A client's audience sheet (Excel, CSV or Google Sheet, Dovesoft-style) is loaded, its columns are mapped to a template, and the summary shows how many numbers will be sent, blocked or invalid before anything is confirmed. Sending itself is M5.

## Tasks

| Task | What                                                | Status                                  |
| ---- | --------------------------------------------------- | --------------------------------------- |
| 4.1  | Upload Excel/CSV, read Google Sheet, store the list | In review: waiting for owner acceptance |
| 4.2  | Number cleaning and validation                      | Not started                             |
| 4.3  | Campaign draft and template mapping                 | Not started                             |
| 4.4  | Summary and dry-run rules                           | Not started                             |
| 4.5  | Campaign creation API contract                      | Not started                             |

Tasks are built and accepted one at a time.

## 4.1 scope

- Upload `.xlsx` or `.csv` through a short-lived signed link; read a Google Sheet shared as "Anyone with the link can view" through its CSV export.
- Keep the file (local disk under `UPLOAD_DIR` until OCI Object Storage exists) and load its rows into `lists` and `list_contacts`, exactly as read.
- Panel: new **Audience lists** page (super user only).

Not in 4.1: cleaning or checking phone numbers (4.2), choosing which column is the number (4.2), templates and campaigns (4.3 onward).

## Decisions taken for 4.1

- **Who uploads:** only `super_admin`, choosing the client, because M2 logins are still in memory and carry no client. Client logins get 403 until M2.2; the contract does not change then.
- **Storage:** local disk behind a storage interface with signed links, so OCI Object Storage can replace it in one module.
- **Excel reading:** a small reader of our own (zip index + streaming XML) instead of exceljs's stream reader, which was measured returning incomplete data for 193 of 200 reads of a small file. exceljs is kept only to build test files.

## Evidence

- [backend-api.md](backend-api.md): routes, request and response bodies, errors
- [database.md](database.md): migration 0004
- [frontend.md](frontend.md): the Audience lists page
- [e2e.md](e2e.md): panel → API → disk → database path, and how to try it
- [test-evidence.md](test-evidence.md): commands and results
