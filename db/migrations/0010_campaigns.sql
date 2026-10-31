-- M7: audience lists, campaigns, opt-outs. Totals on a campaign follow its messages through a trigger, so every
-- status change, wherever it comes from, moves them in the same transaction.
create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  file_name text not null,
  storage_key text not null,
  row_count int not null,
  blank_rows_skipped int not null default 0,
  columns jsonb not null,
  opt_in_confirmed_by uuid not null references users(id),
  opt_in_confirmed_at timestamptz not null,
  number_column int,
  valid_count int,
  invalid_count int,
  duplicate_count int,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index if not exists lists_client_idx on lists (client_id, created_at desc);

create table if not exists list_contacts (
  list_id uuid not null references lists(id),
  row_number int not null,
  client_id uuid not null references clients(id),
  cells jsonb not null,
  number text,
  invalid_reason text,
  duplicate_of_row int,
  primary key (list_id, row_number)
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  name text not null,
  template_id uuid not null references templates(id),
  wa_account_id uuid not null references wa_accounts(id),
  list_id uuid references lists(id),
  variable_map jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  created_by uuid not null references users(id),
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  total int,
  blocked int,
  sent int,
  delivered int,
  read int,
  failed int,
  -- Charged at confirm for rows with no message (invalid or duplicate, when those switches are on).
  other_charged_paise bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_client_idx on campaigns (client_id, created_at desc);
create index if not exists campaigns_status_idx on campaigns (status);

alter table messages drop constraint if exists messages_campaign_fk;
alter table messages add constraint messages_campaign_fk foreign key (campaign_id) references campaigns(id);
create index if not exists messages_campaign_status_idx on messages (campaign_id, status);

create table if not exists opt_outs (
  client_id uuid not null references clients(id),
  number text not null,
  source text not null check (source in ('stop_reply', 'upload', 'manual')),
  created_at timestamptz not null default now(),
  primary key (client_id, number)
);

insert into settings (key, value) values ('stop_words', '["STOP", "UNSUBSCRIBE"]') on conflict (key) do nothing;

create or replace function campaign_totals_follow_message() returns trigger as $$
begin
  -- A move between queued and sending changes no total, so it must not lock the campaign: a worker claiming rows
  -- and a cancel waiting on them would deadlock.
  if new.campaign_id is null or new.status = old.status
     or (new.status in ('queued', 'sending') and old.status in ('queued', 'sending')) then
    return new;
  end if;
  update campaigns set
    sent = sent + (new.status = 'sent')::int - (old.status = 'sent')::int,
    delivered = delivered + (new.status = 'delivered')::int - (old.status = 'delivered')::int,
    read = read + (new.status = 'read')::int - (old.status = 'read')::int,
    failed = failed + (new.status = 'failed')::int - (old.status = 'failed')::int,
    blocked = blocked + (new.status = 'blocked')::int - (old.status = 'blocked')::int
  where id = new.campaign_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists messages_campaign_totals on messages;
create trigger messages_campaign_totals after update of status on messages
  for each row execute function campaign_totals_follow_message();
