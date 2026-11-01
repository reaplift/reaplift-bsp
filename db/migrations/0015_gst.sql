-- GST: a rate with a start date, so history stays, and the rate each charge was made at, so statements stay exact
-- after the rate changes. Amounts in the ledger and on messages include GST.
create table if not exists gst_rates (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  rate_bp int not null check (rate_bp >= 0 and rate_bp <= 5000),
  valid_from timestamptz not null,
  entered_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists gst_rates_lookup_idx on gst_rates (valid_from desc, seq desc);

-- 18% is India's rate for this service as the owner advised on 2 November 2026; the super admin changes it in Settings.
insert into gst_rates (rate_bp, valid_from)
select 1800, '2017-07-01T00:00:00+05:30'
where not exists (select 1 from gst_rates);

alter table wallet_ledger add column if not exists gst_bp int;
alter table messages add column if not exists gst_bp int;
alter table campaigns add column if not exists gst_bp int;

create index if not exists wallet_ledger_created_idx on wallet_ledger (created_at);
