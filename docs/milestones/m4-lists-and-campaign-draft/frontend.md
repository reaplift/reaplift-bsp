# M4 frontend

## Audience lists page (task 4.1)

File: `apps/web/src/pages/Lists.tsx`. Menu item **Audience lists**, shown only to `super_admin` (`canAccessPage` in `packages/shared`).

### What the page does

1. **Client:** a picker filled from `GET /api/clients` (the `clients` table). With no clients it says to run `pnpm seed:dev-clients`.
2. **List name:** required, up to 120 characters.
3. **Upload a file / Google Sheet link:** a two-way switch.
   - File: `.xlsx` or `.csv`. The page asks for a signed link, sends the file to it with a progress percentage, then asks the server to import it.
   - Link: the Google Sheet address; the server downloads and imports it.
4. **Header row (optional):** blank detects it; a number forces that row; `0` means no header.
5. **Import list:** the button is disabled while working, and the step shows next to it (getting link, uploading %, reading rows).

### After an import

A panel shows the rows, columns, header row, blank rows skipped and file name, then a table of the first 10 rows with their sheet row numbers. If the header was not row 1, a note says the rows above it were treated as titles, and how to import again with a different header row.

Below it, **Lists for this client** shows every list, newest first, with source, row count, date and who added it. **View** opens a list's preview.

### Errors

Every server error shows its `message` in a red box, for example "Google asked for a sign-in, so the sheet is private. Share it as 'Anyone with the link can view' and try again." A 401 says the session has ended and to log in again. Login sessions are kept in memory, so restarting the server logs everyone out; that is an M2 limitation.
