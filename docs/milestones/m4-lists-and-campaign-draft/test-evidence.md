# M4 test evidence

## 4.1 Upload and list storage

Run on 28 October 2026, Windows 11 laptop, PostgreSQL 16 in Docker, branch `m4-skeleton`.

### Commands

| Command          | Result                                                         |
| ---------------- | -------------------------------------------------------------- |
| `pnpm lint`      | pass                                                           |
| `pnpm typecheck` | pass                                                           |
| `pnpm test`      | 86 tests pass (13 files); see the note on one failed run below |
| `pnpm test:int`  | 19 tests pass (3 files), against real PostgreSQL               |
| `pnpm build`     | pass                                                           |

### What the tests prove

LLD row for 4.1: "Sample files with blank rows, merged headers, text-formatted numbers; a private sheet gives a clear error. Accepted when files up to 200K rows load into `lists` and `list_contacts`."

| Check                                                                    | Test file                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| Blank rows skipped and counted; row numbers kept                         | `lists-read-sheet.test.ts`                          |
| Merged title banner and merged header cell (Excel)                       | `lists-read-sheet.test.ts`, `lists.int.test.ts`     |
| Text-formatted numbers keep leading zeros; numbers never in E notation   | `lists-read-sheet.test.ts`                          |
| Dates, formulas, booleans, errors, links, rich text, Hindi text          | `lists-read-sheet.test.ts`                          |
| First tab as Excel shows it; hidden first tab passed over                | `lists-read-sheet.test.ts`                          |
| Worksheets stored before `workbook.xml` in the zip                       | `lists-read-sheet.test.ts`                          |
| The same workbook read 50 times gives the same result                    | `lists-read-sheet.test.ts`                          |
| Private Google Sheet: clear "share it" error, nothing saved              | `lists-google-sheet.test.ts`, `lists.int.test.ts`   |
| Missing sheet, Google down, redirect away from Google refused            | `lists-google-sheet.test.ts`                        |
| Signed links: altered, expired, reused                                   | `lists-upload-storage.test.ts`, `lists.int.test.ts` |
| Over-size upload stopped and removed                                     | `lists-upload-storage.test.ts`                      |
| 401 without login, 403 for client and staff logins                       | `lists.int.test.ts`                                 |
| Client B cannot import, list or open client A's lists                    | `lists.int.test.ts`                                 |
| Importing the same upload twice (also at the same moment) makes one list | `lists.int.test.ts`                                 |
| Unreadable file or too many rows saves nothing (rollback)                | `lists.int.test.ts`                                 |
| Migration 0004: both tables carry a non-null `client_id`                 | `migrate.int.test.ts`                               |
| **200,000-row CSV loads**                                                | `lists.int.test.ts`: 4.9 s                          |
| **200,000-row Excel file (3.8 MB) loads**                                | `lists.int.test.ts`: 5.1 s                          |
| 200,001 rows refused                                                     | `lists.int.test.ts`                                 |

Two deliberate breakages were tried to make sure the tests catch them: removing the client filter when opening a list failed the isolation test, and removing blank-row counting failed three reader tests.

### Live run on the local servers

Through the Vite proxy (`localhost:5173`), the same path the panel uses:

| Input                                                    | Result                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| Dovesoft-style `.xlsx` (title, merged header, blank row) | 201: 3 rows, header row 2, 1 blank skipped, `09812345678` kept |
| CSV with blank rows                                      | 201: 3 rows, 2 blank skipped                                   |
| Workbook with reordered tabs                             | 201: rows of the tab Excel shows first                         |
| `.csv` renamed to `.xlsx`                                | 422 `INVALID_FILE`                                             |
| 200,000-row `.xlsx`                                      | 201: 200,000 rows, about 5.6 s                                 |
| 200,000-row `.csv`                                       | 201: 200,000 rows, about 5.3 s                                 |
| 200,001-row `.csv`                                       | 422 `LIST_TOO_LARGE`, nothing saved                            |
| Google's public sample sheet (real Google, no fake)      | 201: 30 rows, file "Example Spreadsheet - Class Data.csv"      |
| A Google Sheets ID that does not exist                   | 404 `SHEET_NOT_FOUND`                                          |
| `client_admin` login lists the lists                     | 403 `FORBIDDEN`                                                |

Database afterwards: for every list, `total_rows` equals the rows in `list_contacts`, and every row carries the list's `client_id`.

### Found and fixed while testing

- **exceljs's streaming Excel reader returned incomplete data** (unread shared strings, missing sheets) in 193 of 200 reads of a 7 KB file from disk, and sometimes crashed. It was replaced by a reader that opens each part through the zip index; the same measurement then gave 0 of 200 wrong.
- **"First worksheet" meant the first file in the zip**, not the first tab, so a workbook with reordered tabs could import the wrong list. It now follows the tab order in `workbook.xml`.
- **A rejected over-size upload left its partial file behind**, which made the link unusable. Fixed, with a test.

### Not verified here

- **A private Google Sheet against real Google.** It needs a sheet that is not shared; the behaviour is tested against a fake Google that redirects to the sign-in page, which is what Google did for private sheets when last checked, from memory.
- **Clicking through the panel in a browser.** The page builds and typechecks, and its API calls were run through the same proxy; the browser walkthrough is part of the owner's acceptance test.
- **One unexplained unit-test failure.** In the final run, `pnpm test` reported 1 failure in 86. It did not happen again in 26 further runs, including runs under extra load, and its output was not kept, so the test is not known. CI on the pull request is the next check.
