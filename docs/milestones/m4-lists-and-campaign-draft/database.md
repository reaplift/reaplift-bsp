# M4 database

## Migration 0004_lists.sql (task 4.1)

Additive only: two new tables.

### lists

One row per imported file or Google Sheet.

| Column               | Type        | Notes                                                                                  |
| -------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `id`                 | uuid pk     |                                                                                        |
| `client_id`          | uuid        | not null, references `clients`                                                         |
| `name`               | text        | given by the person importing                                                          |
| `source`             | text        | `upload` or `google_sheet`                                                             |
| `file_name`          | text        | original file name, or Google's "<sheet> - <tab>.csv"                                  |
| `source_url`         | text        | the Google Sheet link; null for uploads                                                |
| `storage_key`        | text unique | `lists/<client id>/<uuid>.<csv or xlsx>`; unique, so one file becomes at most one list |
| `size_bytes`         | bigint      |                                                                                        |
| `columns`            | jsonb       | column names in sheet order                                                            |
| `header_row`         | int         | sheet row of the header; null when the sheet has none                                  |
| `total_rows`         | int         | data rows saved                                                                        |
| `blank_rows_skipped` | int         | blank rows between the header and the last data row                                    |
| `created_by`         | text        | login email (users are not database-backed until M2.1)                                 |
| `created_at`         | timestamptz |                                                                                        |

Index: `(client_id, created_at desc)` for the client's list page.

### list_contacts

One row per data row, kept exactly as read.

| Column       | Type  | Notes                                                  |
| ------------ | ----- | ------------------------------------------------------ |
| `list_id`    | uuid  | references `lists`, `on delete cascade`                |
| `client_id`  | uuid  | not null, references `clients`                         |
| `row_number` | int   | row number as Excel shows it                           |
| `cells`      | jsonb | cell text in column order (`values` is an SQL keyword) |

Primary key `(list_id, row_number)`; index on `client_id`.

Task 4.2 adds nullable columns here for the cleaned number and the reason a number is invalid.

## Queries and client scope

Every read filters by both the list ID and `client_id`, so a list ID from another client returns nothing (404). Writes happen in one transaction per import: the `lists` row, all `list_contacts` rows in batches of 5,000, then the counts. Any failure (unreadable file, too many rows) rolls all of it back.

## Size

200,000 rows of 3 to 5 short columns load in about 5 to 9 seconds on a laptop (see [test-evidence.md](test-evidence.md)).
