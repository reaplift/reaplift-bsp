-- M5: how a number was connected, a template's life at Meta, and platform settings.
alter table wa_accounts
  add column if not exists onboarded_via text,
  add column if not exists credit_share_ref text,
  add column if not exists two_step_pin_enc bytea,
  add column if not exists connected_by uuid references users(id),
  add column if not exists connected_at timestamptz;

alter table templates
  add column if not exists validation_errors jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references users(id),
  add column if not exists rejection_reason text,
  add column if not exists meta_recommendation text,
  add column if not exists media_storage_key text,
  add column if not exists created_by uuid references users(id);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

insert into settings (key, value)
values ('promo_words', '["flat", "% off", "discount", "offer", "sale", "coupon", "buy now", "limited time", "deal"]')
on conflict (key) do nothing;
