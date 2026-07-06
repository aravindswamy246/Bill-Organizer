-- Base table grants for anon/authenticated.
-- Row-level security policies only restrict rows; without an explicit GRANT,
-- Postgres denies the underlying select/insert/update/delete outright before
-- RLS is ever evaluated. Also set default privileges so future tables in
-- this schema inherit the same grants automatically.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public
to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
grant select, insert, update, delete on tables to anon, authenticated;

alter default privileges in schema public
grant usage, select on sequences to anon, authenticated;
