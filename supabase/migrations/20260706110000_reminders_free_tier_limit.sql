-- Server-side enforcement of the free-tier "max 2 active reminders" rule
-- (CLAUDE.md / prompt.md §freemium). Until now this was only checked
-- client-side (src/app/(app)/bills/[id].tsx counts active reminders before
-- inserting) — a modified client, or a call straight against the
-- supabase-js REST API with a valid user JWT, could insert unlimited
-- reminders since the RLS policy "reminders are manageable by owner" only
-- checks ownership, not tier/count. This trigger makes the limit
-- authoritative at the database layer regardless of what the client sends.
--
-- Only reminder *creation/reactivation* is limited — viewing/listing
-- reminders (useReminders.ts) and deactivating one are never restricted.
create function public.enforce_free_tier_reminder_limit () returns trigger as $$
declare
  tier public.subscription_tier;
  active_count integer;
begin
  -- Only the transition into "active" needs checking: a brand new active
  -- reminder, or an existing inactive one being reactivated.
  if not new.active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active then
    return new;
  end if;

  select subscription_tier into tier from public.profiles where id = new.user_id;

  if tier = 'premium' then
    return new;
  end if;

  select count(*) into active_count
  from public.reminders
  where user_id = new.user_id
    and active
    and id <> new.id;

  if active_count >= 2 then
    raise exception 'free tier is limited to 2 active reminders' using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger reminders_enforce_free_tier_limit before insert or update on public.reminders for each row
execute function public.enforce_free_tier_reminder_limit ();
