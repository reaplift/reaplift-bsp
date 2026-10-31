-- Money set aside for a scheduled campaign. It is not spent, so it is not in the ledger; it only lowers what is available.
create table if not exists wallet_holds (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  campaign_id uuid not null references campaigns(id),
  amount_paise bigint not null check (amount_paise > 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_because text check (released_because in ('started', 'unscheduled', 'cancelled', 'not_started'))
);
create unique index if not exists wallet_holds_active_idx on wallet_holds (campaign_id) where released_at is null;
create index if not exists wallet_holds_client_idx on wallet_holds (client_id) where released_at is null;
