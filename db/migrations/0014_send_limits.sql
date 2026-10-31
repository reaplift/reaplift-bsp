-- The super admin's daily limit per number. Null means only Meta's limit applies. The speed limit is send_rate_per_sec (0002).
alter table wa_accounts add column if not exists daily_send_limit int;
create index if not exists messages_account_sent_idx on messages (wa_account_id, sent_at) where sent_at is not null;
