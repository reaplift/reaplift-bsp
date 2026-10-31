-- M9: daily figures for the dashboard, and what Meta actually bills.
-- Meta's rates have fractions of a paisa. Whole paise per message would overstate a utility rate of 11.50 by about 4%,
-- enough to fail the invoice check, so ReapLift's cost is kept in hundredths of a paisa like the rate it comes from.
alter table messages
  add column if not exists meta_cost_centipaise bigint,
  add column if not exists pricing_type text;

create index if not exists messages_delivered_idx on messages (delivered_at) where meta_cost_centipaise is not null;
create index if not exists messages_queued_idx on messages (queued_at);

create table if not exists daily_stats (
  client_id uuid not null references clients(id),
  date date not null,
  category text not null,
  queued int not null default 0,
  sent int not null default 0,
  delivered int not null default 0,
  read int not null default 0,
  failed int not null default 0,
  blocked int not null default 0,
  client_charge_paise bigint not null default 0,
  meta_cost_centipaise bigint not null default 0,
  primary key (client_id, date, category)
);

create table if not exists meta_invoices (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  total_paise bigint not null check (total_paise >= 0),
  per_account jsonb,
  entered_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists meta_invoices_month_idx on meta_invoices (month, created_at desc);
