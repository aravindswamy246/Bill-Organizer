-- Grant service_role base table privileges on the public schema.
--
-- service_role has BYPASSRLS, but Postgres still enforces the underlying
-- GRANT system before RLS is ever considered — BYPASSRLS only skips row
-- filtering, it doesn't imply table access. The previous grants migration
-- (20260706070200) only granted anon/authenticated, so any server-side
-- edge function using the service-role key (e.g. `send-reminders`, which
-- must scan reminders across every user) would hit "permission denied"
-- despite using the correct client. Storage/auth schemas already grant
-- service_role automatically as part of the Supabase platform's own setup;
-- this does the equivalent for tables we create in `public`.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public
to service_role;

grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
grant usage, select on sequences to service_role;
