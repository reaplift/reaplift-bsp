# M4 end to end

## 4.1: from the panel to the database

```
Audience lists page
  → POST /api/lists/uploads            checks login, client, file type and size; returns a 15-minute signed link
  → PUT  /api/lists/uploads/<id>?sig=… checks the signature; streams the bytes to UPLOAD_DIR/lists/<client>/<id>
  → POST /api/lists/import             reads the file, and in one transaction writes lists + list_contacts
  ← list with counts and the first 10 rows
  → GET  /api/lists?clientId=…         the client's lists
```

A Google Sheet goes straight to `POST /api/lists/import`; the server fetches `…/export?format=csv&gid=…`, follows Google's redirect to `googleusercontent.com`, keeps a copy in `UPLOAD_DIR`, then imports it like an upload.

## Try it locally

```bash
pnpm db:up
pnpm migrate
pnpm seed:dev-clients        # adds "ReapLift Test Client" and "Second Test Client"
pnpm dev
```

Open http://localhost:5173, log in as `admin@reaplift.ai` / `password123` / `super_admin`, then open **Audience lists**.

| Try                                                                                                                 | Expect                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| An Excel file with a title row, a merged header and blank rows                                                      | Header row detected below the title; blank rows skipped and counted; leading zeros kept |
| A CSV with blank rows                                                                                               | Same counts as you see in the file                                                      |
| An Excel file whose tabs were reordered                                                                             | The tab shown first in Excel is read                                                    |
| A file renamed from `.csv` to `.xlsx`                                                                               | "The file could not be read as an Excel workbook…"                                      |
| 200,000 rows                                                                                                        | Loads in roughly 5 to 10 seconds                                                        |
| 200,001 rows                                                                                                        | "The list has more than 200000 rows…" and nothing is saved                              |
| `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit` (Google's public sample) | 30 rows, file "Example Spreadsheet - Class Data.csv"                                    |
| One of your own sheets, not shared                                                                                  | "Google asked for a sign-in, so the sheet is private…"                                  |
| The same list for the other client                                                                                  | Not visible there                                                                       |
| Log in as `client@reaplift.ai` (client_admin)                                                                       | No Audience lists menu; the API answers 403                                             |

Note: `pnpm test:int` resets the database it runs against, which is the same local database `pnpm dev` uses. Run `pnpm migrate` and `pnpm seed:dev-clients` again after it.
