-- M8: scheduling, cancelling, and rules that block numbers at summary and confirm.
alter table campaigns
  add column if not exists scheduled_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references users(id);

create index if not exists campaigns_due_idx on campaigns (scheduled_at) where status = 'scheduled';

create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  type text not null check (type in ('repeat_within_hours', 'marketing_cap')),
  values jsonb not null,
  enabled boolean not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists rules_global_idx on rules (type) where client_id is null;
create unique index if not exists rules_client_idx on rules (client_id, type) where client_id is not null;
