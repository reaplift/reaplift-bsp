-- M6: Meta's rates, what each client pays, what is charged for each outcome, and the append-only ledger.
create table if not exists meta_rates (
  id uuid primary key default gen_random_uuid(),
  -- The rate entered last wins for the same start date.
  seq bigint generated always as identity,
  category text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  country_calling_code text not null,
  rate_centipaise bigint not null check (rate_centipaise >= 0),
  valid_from timestamptz not null,
  entered_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists meta_rates_lookup_idx on meta_rates (category, country_calling_code, valid_from desc);

-- client_id null is the default for all clients. `default` hands a client back to it.
create table if not exists pricing (
  id uuid primary key default gen_random_uuid(),
  -- The newest row wins, even when two share a timestamp.
  seq bigint generated always as identity,
  client_id uuid references clients(id),
  mode text not null check (mode in ('markup', 'fixed', 'default')),
  markup_marketing_bp int,
  markup_utility_bp int,
  markup_authentication_bp int,
  fixed_marketing_paise bigint,
  fixed_utility_paise bigint,
  fixed_authentication_paise bigint,
  valid_from timestamptz not null default now(),
  updated_by uuid references users(id)
);
create index if not exists pricing_client_idx on pricing (client_id, valid_from desc);

insert into pricing (client_id, mode, markup_marketing_bp, markup_utility_bp, markup_authentication_bp)
select null, 'markup', 2500, 2500, 2500
where not exists (select 1 from pricing where client_id is null);

create table if not exists price_lists (
  id bigint generated always as identity primary key,
  client_id uuid not null references clients(id),
  category text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  country_calling_code text not null,
  price_paise bigint not null check (price_paise >= 0),
  source text not null check (source in ('markup', 'fixed')),
  meta_rate_id uuid references meta_rates(id),
  valid_from timestamptz not null
);
create index if not exists price_lists_lookup_idx on price_lists (client_id, category, country_calling_code, valid_from desc, id desc);

create table if not exists charge_policy (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  outcome text not null check (outcome in ('blocked', 'sent_not_delivered', 'delivered', 'failed', 'invalid', 'duplicate')),
  charged boolean not null
);
create unique index if not exists charge_policy_global_idx on charge_policy (outcome) where client_id is null;
create unique index if not exists charge_policy_client_idx on charge_policy (client_id, outcome) where client_id is not null;

-- HLD section 5, and D6's default for invalid and duplicate.
insert into charge_policy (client_id, outcome, charged) values
  (null, 'blocked', true),
  (null, 'sent_not_delivered', true),
  (null, 'delivered', true),
  (null, 'failed', false),
  (null, 'invalid', false),
  (null, 'duplicate', false)
on conflict do nothing;

create table if not exists wallet_ledger (
  id bigint generated always as identity primary key,
  client_id uuid not null references clients(id),
  kind text not null check (kind in ('topup', 'adjustment', 'charge', 'refund')),
  amount_paise bigint not null,
  balance_after_paise bigint not null,
  campaign_id uuid,
  message_id bigint,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists wallet_ledger_client_idx on wallet_ledger (client_id, id desc);
create unique index if not exists wallet_ledger_refund_once_idx on wallet_ledger (message_id) where kind = 'refund';

create or replace function wallet_ledger_append_only() returns trigger as $$
begin
  raise exception 'wallet_ledger rows cannot be changed or deleted';
end;
$$ language plpgsql;

drop trigger if exists wallet_ledger_no_change on wallet_ledger;
create trigger wallet_ledger_no_change before update or delete on wallet_ledger
  for each row execute function wallet_ledger_append_only();
