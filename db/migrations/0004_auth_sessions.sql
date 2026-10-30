-- M1 tasks 1.2 and 1.3: login sessions held in PostgreSQL, and login lockout.
-- The `sessions` table from 0003 is not used: its client_id is not null, and a super admin has no client.

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid references clients(id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_address text
);

create index if not exists auth_sessions_user_idx on auth_sessions (user_id);
create index if not exists auth_sessions_client_idx on auth_sessions (client_id);

alter table users add column if not exists failed_login_count int;
alter table users add column if not exists first_failed_login_at timestamptz;
alter table users add column if not exists locked_until timestamptz;
