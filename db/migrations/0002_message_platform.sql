create extension if not exists pgcrypto;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  contact_email text,
  low_balance_alert_paise bigint,
  created_at timestamptz not null default now()
);

create table if not exists wa_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone text not null,
  display_name text,
  access_token_enc bytea not null,
  quality_rating text,
  messaging_limit text,
  meta_payer text not null default 'reaplift_card' check (meta_payer in ('reaplift_card', 'partner_credit_line', 'reaplift_credit_line')),
  send_rate_per_sec int not null default 20,
  status text not null default 'active' check (status in ('active', 'paused')),
  paused_reason text,
  created_at timestamptz not null default now()
);

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  wa_account_id uuid not null references wa_accounts(id),
  meta_template_id text,
  name text not null,
  language text not null,
  category text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  components jsonb not null,
  variable_count int not null default 0,
  status text not null,
  updated_at timestamptz not null default now(),
  unique (wa_account_id, name, language)
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  client_id uuid not null references clients(id),
  wa_account_id uuid not null references wa_accounts(id),
  campaign_id uuid,
  template_id uuid not null references templates(id),
  to_number text not null,
  variables jsonb not null default '[]',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'blocked')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  meta_message_id text unique,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  block_reason text,
  failure_reason text,
  meta_error_code int,
  pricing_category text,
  billable boolean,
  client_price_paise bigint,
  meta_cost_paise bigint,
  source text not null default 'panel' check (source in ('panel', 'api', 'crm', 'cli')),
  created_date date not null default current_date
);

create index if not exists messages_queue_idx on messages (next_attempt_at) where status = 'queued';
create index if not exists messages_client_date_idx on messages (client_id, created_date);
create index if not exists messages_rule_idx on messages (client_id, to_number, created_date);

create table if not exists meta_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  body jsonb not null,
  processed_at timestamptz,
  process_error text
);

create index if not exists meta_events_todo_idx on meta_events (id) where processed_at is null;

create table if not exists message_status_events (
  meta_message_id text not null,
  status text not null,
  meta_timestamp timestamptz not null,
  meta_event_id bigint not null references meta_events(id),
  primary key (meta_message_id, status)
);
