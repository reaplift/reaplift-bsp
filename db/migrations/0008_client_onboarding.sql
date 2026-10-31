-- M3: a client's country picks its Meta rates and which audience numbers it may use; a first password must be changed.
alter table clients add column if not exists country_calling_code text;
alter table users add column if not exists must_change_password boolean;

create unique index if not exists clients_name_lower_idx on clients (lower(name));
create index if not exists audit_logs_action_idx on audit_logs (action, id desc);
