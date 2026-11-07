-- When a login was locked by wrong passwords. It stays locked for 24 hours, or until a super admin unlocks it
-- or resets its password (owner, 7 November 2026). Null when not locked.
alter table users add column if not exists login_locked_at timestamptz;
