-- M2 task 2.1: one row per recipient per channel, written by notify() in the same transaction as the change.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  user_id uuid references users(id),
  email text not null,
  event text not null,
  entity_id text not null,
  payload jsonb not null,
  channel text not null check (channel in ('email', 'panel')),
  status text not null check (status in ('pending', 'sent', 'failed', 'read')),
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (event, entity_id, email, channel)
);

-- The delivery loop's claim query.
create index if not exists notifications_due_idx on notifications (next_attempt_at)
  where channel = 'email' and status = 'pending';
-- The panel's list (M3 3.7) and the delivery log.
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
create index if not exists notifications_client_created_idx on notifications (client_id, created_at desc);
