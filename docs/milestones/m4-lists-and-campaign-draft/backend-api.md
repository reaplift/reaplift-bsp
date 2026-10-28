# M4 backend API

Contracts for milestone 4. Each task adds its own section; the code must match these exactly.

Every route here returns errors as `{ "error": "<CODE>", "message": "<text for a person>" }`.

## 4.1 Upload and list storage

### Who can call these routes

Until M2.2 attaches a client to every session, only `super_admin` uploads lists, and every request names the client it acts for with `clientId`. The client must exist in the `clients` table.

| Caller                                                    | Result                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| No `Authorization` header, or an unknown or expired token | 401 `UNAUTHORIZED`                                                       |
| Logged in as `staff` or `client_admin`                    | 403 `FORBIDDEN`                                                          |
| `super_admin`, `clientId` not in `clients`                | 404 `CLIENT_NOT_FOUND`                                                   |
| `super_admin`, list belongs to another client             | 404 `LIST_NOT_FOUND` / `UPLOAD_NOT_FOUND` (never reveals that it exists) |

When M2.2 lands, `clientId` comes from the session for client logins and stays a parameter for super users; the request and response bodies do not change.

### Upload flow

```
panel                        api                               local disk (Object Storage later)
  | POST /api/lists/uploads     |                                     |
  |---------------------------->| checks client, name, size           |
  |<---- uploadId, uploadUrl ---| (signed, 15 min)                    |
  | PUT uploadUrl (file bytes)  |                                     |
  |---------------------------->| checks signature, streams bytes --->| lists/<clientId>/<uploadId>
  | POST /api/lists/import      |                                     |
  |---------------------------->| reads file, one transaction:        |
  |                             |   lists row + list_contacts rows    |
  |<------ list + preview ------|                                     |
```

A Google Sheet skips the first two steps: `POST /api/lists/import` with the sheet's link. The server downloads the CSV export, keeps a copy in storage (so the list can always be traced to the exact data it came from), then imports it the same way.

### POST /api/lists/uploads

Creates a one-time signed link to upload one file.

Request:

```json
{
  "clientId": "5b0f2c1e-8a4e-4c39-9a51-0d6c1f6e2a10",
  "fileName": "october-leads.xlsx",
  "sizeBytes": 482113
}
```

| Field       | Rule                                                             |
| ----------- | ---------------------------------------------------------------- |
| `clientId`  | uuid, must exist in `clients`                                    |
| `fileName`  | 1 to 255 characters, ends in `.csv` or `.xlsx` (any letter case) |
| `sizeBytes` | whole number, 1 to `UPLOAD_MAX_BYTES` (default 50 MB)            |

Success 201:

```json
{
  "uploadId": "0d4b6a52-3c0e-4a8f-b8a5-7a61c2f4e9d1.xlsx",
  "uploadUrl": "/api/lists/uploads/0d4b6a52-3c0e-4a8f-b8a5-7a61c2f4e9d1.xlsx?clientId=5b0f…&expires=1793174000&sig=9c1e…",
  "expiresAt": "2026-10-28T10:33:20.000Z",
  "maxBytes": 52428800
}
```

Errors: 400 `INVALID_REQUEST`, 400 `UNSUPPORTED_FILE_TYPE` (for example `.xls`: "Save the file as .xlsx or .csv and upload again"), 413 `FILE_TOO_LARGE`, 401, 403, 404 `CLIENT_NOT_FOUND`.

### PUT /api/lists/uploads/:uploadId?clientId&expires&sig

Receives the file bytes. The signature is the permission, so no `Authorization` header is needed; this is what lets the same link later point at Object Storage instead of the API. Any `Content-Type` is accepted; the body is stored as is.

Success 200:

```json
{ "uploadId": "0d4b6a52-3c0e-4a8f-b8a5-7a61c2f4e9d1.xlsx", "bytes": 482113 }
```

Errors:

| Status | Code                | When                                                                 |
| ------ | ------------------- | -------------------------------------------------------------------- |
| 403    | `INVALID_SIGNATURE` | Signature missing or does not match the client, upload ID and expiry |
| 410    | `LINK_EXPIRED`      | Past `expiresAt`                                                     |
| 409    | `ALREADY_UPLOADED`  | A file is already stored for this upload ID; links are single use    |
| 413    | `FILE_TOO_LARGE`    | More than `UPLOAD_MAX_BYTES` arrived; the partial file is removed    |

### POST /api/lists/import

Reads an uploaded file or a Google Sheet into a new list. Runs in one database transaction: either the list and all its rows are saved, or nothing is.

Request, uploaded file:

```json
{
  "clientId": "5b0f2c1e-8a4e-4c39-9a51-0d6c1f6e2a10",
  "name": "October leads",
  "source": { "type": "upload", "uploadId": "0d4b6a52-3c0e-4a8f-b8a5-7a61c2f4e9d1.xlsx" }
}
```

Request, Google Sheet:

```json
{
  "clientId": "5b0f2c1e-8a4e-4c39-9a51-0d6c1f6e2a10",
  "name": "October leads",
  "headerRow": 2,
  "source": {
    "type": "google_sheet",
    "url": "https://docs.google.com/spreadsheets/d/1Bxi…/edit#gid=0"
  }
}
```

| Field        | Rule                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | 1 to 120 characters after trimming                                                                                                 |
| `headerRow`  | optional. Leave out to detect it (rule below). A row number from the sheet to use that row. `0` means the sheet has no header row. |
| `source.url` | a `docs.google.com/spreadsheets/d/<id>/…` link; the tab is taken from `gid=` in the link, otherwise the first tab                  |

How a sheet is read:

- Excel: only the first tab is read, as Excel shows the tabs (from `xl/workbook.xml`, not the internal file names, which do not change when tabs are moved). A hidden first tab is passed over for the first visible one. `.xls`, `.xlsb` and password-protected files are not read.
- Blank rows (every cell empty or spaces) are skipped and counted in `blankRowsSkipped`.
- Header row, when `headerRow` is left out: the first row with at least two filled cells, looking at the first 20 filled rows. Rows above it (titles, merged banners) are skipped. If none of those rows has two filled cells, the list has one column and its first filled row is the header.
- Column names: the header cell text. An empty header cell (including the hidden half of a merged header) is named after its letter, `Column C`. A repeated name gets a suffix, `Name (2)`. Data that runs past the last header gets `Column F` and so on.
- Cell values are saved as text with surrounding spaces removed. Text-formatted numbers keep leading zeros (`09812345678`). Whole numbers are written out in full (`919812345678`, never `9.19812E+11`). Dates become `2026-10-28`. Formulas save their result.
- `rowNumber` is the row number as shown in Excel or Google Sheets, so a person can find a row in the original file.
- `cells` follows `columns`; empty cells at the end of a row are left off, so `cells` can be shorter than `columns`.
- Phone numbers are not cleaned or checked here; that is task 4.2.

Success 201 (same body as `GET /api/lists/:id`):

```json
{
  "id": "8f1d6a90-2b77-4a43-9f0e-1c5b2b4f7d33",
  "clientId": "5b0f2c1e-8a4e-4c39-9a51-0d6c1f6e2a10",
  "name": "October leads",
  "source": "upload",
  "fileName": "october-leads.xlsx",
  "sourceUrl": null,
  "columns": ["Name", "Mobile", "City"],
  "headerRow": 2,
  "totalRows": 3,
  "blankRowsSkipped": 1,
  "sizeBytes": 482113,
  "createdBy": "admin@reaplift.ai",
  "createdAt": "2026-10-28T10:20:11.000Z",
  "preview": [
    { "rowNumber": 3, "cells": ["Amit", "9812345678", "Pune"] },
    { "rowNumber": 4, "cells": ["Riya", "09812345679", "Delhi"] },
    { "rowNumber": 6, "cells": ["Sam", "+91 98123 45680"] }
  ]
}
```

`preview` holds the first 10 rows.

Errors:

| Status | Code                 | When                                                                                                     |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_REQUEST`    | Body fails the rules above                                                                               |
| 404    | `CLIENT_NOT_FOUND`   |                                                                                                          |
| 404    | `UPLOAD_NOT_FOUND`   | No file stored for this upload ID under this client                                                      |
| 409    | `ALREADY_IMPORTED`   | This upload already became a list; importing twice never makes two lists                                 |
| 422    | `INVALID_FILE`       | The file cannot be read as CSV or Excel (for example a renamed `.xls`, or a password-protected workbook) |
| 422    | `EMPTY_LIST`         | No data rows after the header, or a workbook with no worksheets                                          |
| 422    | `HEADER_ROW_EMPTY`   | `headerRow` points at an empty row                                                                       |
| 422    | `LIST_TOO_LARGE`     | More than `LIST_MAX_ROWS` data rows (default 200,000)                                                    |
| 413    | `FILE_TOO_LARGE`     | A Google Sheet bigger than `UPLOAD_MAX_BYTES`, or a workbook holding more than 200 MB of text            |
| 422    | `INVALID_SHEET_URL`  | Not a Google Sheets link                                                                                 |
| 422    | `SHEET_NOT_PUBLIC`   | Google asks for a sign-in: "Share the sheet as 'Anyone with the link can view' and try again"            |
| 404    | `SHEET_NOT_FOUND`    | Google says the sheet does not exist (also shown when it may be private)                                 |
| 502    | `SHEET_FETCH_FAILED` | Google did not answer, timed out, or stopped part way                                                    |

### GET /api/lists?clientId=

The client's lists, newest first, at most 100.

```json
{
  "lists": [
    {
      "id": "8f1d6a90-…",
      "clientId": "5b0f…",
      "name": "October leads",
      "source": "upload",
      "fileName": "october-leads.xlsx",
      "sourceUrl": null,
      "columns": ["Name", "Mobile", "City"],
      "headerRow": 2,
      "totalRows": 3,
      "blankRowsSkipped": 1,
      "sizeBytes": 482113,
      "createdBy": "admin@reaplift.ai",
      "createdAt": "2026-10-28T10:20:11.000Z"
    }
  ]
}
```

Errors: 400 `INVALID_REQUEST`, 401, 403, 404 `CLIENT_NOT_FOUND`.

### GET /api/lists/:id?clientId=

One list with `preview` (first 10 rows), as in the import response. 404 `LIST_NOT_FOUND` when the list does not exist or belongs to another client.

### GET /api/clients

Super user only. Clients from the `clients` table, for the client picker on the Lists page: `{ "clients": [{ "id", "name", "status" }] }`. The admin screens from M2 still keep their clients in memory; M2.3 should move them onto this table so both pages show the same clients.

### Settings

| Name                    | Default                                                      | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `UPLOAD_DIR`            | `var/uploads` (under `apps/server` when run with `pnpm dev`) | Where uploaded and downloaded files are kept until Object Storage exists |
| `UPLOAD_SIGNING_SECRET` | a fixed dev value                                            | Signs upload links. Must be set on any shared server                     |
| `UPLOAD_MAX_BYTES`      | `52428800` (50 MB)                                           | Largest file accepted, uploaded or downloaded                            |
| `LIST_MAX_ROWS`         | `200000`                                                     | Most data rows in one list                                               |
