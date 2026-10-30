create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('super_admin', 'staff', 'client')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists users_client_idx on users (client_id);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid not null references clients(id),
  token_hash text not null unique,
  refresh_token_hash text,
  user_agent text,
  ip_address text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_client_idx on sessions (client_id);
create index if not exists sessions_expires_idx on sessions (expires_at);

create table if not exists staff_clients (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references users(id) on delete cascade,
  client_id uuid not null references clients(id),
  created_at timestamptz not null default now(),
  unique (staff_user_id, client_id)
);

create index if not exists staff_clients_client_idx on staff_clients (client_id);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  client_id uuid references clients(id),
  user_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_client_created_idx on audit_logs (client_id, created_at desc);
create index if not exists audit_logs_user_created_idx on audit_logs (user_id, created_at desc);
