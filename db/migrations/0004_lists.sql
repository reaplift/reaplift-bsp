-- Milestone 4.1: uploaded audience lists.
-- A list is one imported file or Google Sheet; list_contacts holds its rows exactly as read.
-- Number cleaning and validity (task 4.2) add their own nullable columns later.

create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  name text not null,
  source text not null check (source in ('upload', 'google_sheet')),
  file_name text not null,
  source_url text,
  storage_key text not null unique,          -- one list per stored file, so an upload cannot be imported twice
  size_bytes bigint not null,
  columns jsonb not null,                    -- column names in sheet order
  header_row int,                            -- sheet row number of the header; null when the sheet has none
  total_rows int not null,
  blank_rows_skipped int not null default 0,
  created_by text not null,                  -- login email until users are database-backed (M2.1)
  created_at timestamptz not null default now()
);

create index if not exists lists_client_created_idx on lists (client_id, created_at desc);

create table if not exists list_contacts (
  list_id uuid not null references lists(id) on delete cascade,
  client_id uuid not null references clients(id),
  row_number int not null,                   -- row number in the original sheet, as Excel shows it
  cells jsonb not null,                      -- cell text in column order
  primary key (list_id, row_number)
);

create index if not exists list_contacts_client_idx on list_contacts (client_id);
