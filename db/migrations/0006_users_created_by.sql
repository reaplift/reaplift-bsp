-- Who added this user, so that with several super admins we know who it was.
-- Null for users added before this column existed, and for the very first super admin.

alter table users add column if not exists created_by uuid references users(id);
