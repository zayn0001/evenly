-- Evenly gets its own schema, so it can share the Supabase project with other apps without
-- name clashes (`public.groups` was a very generic name). Same tables, rules and behaviour.
-- The API must expose the `evenly` schema (supabase/config.toml locally; Dashboard > API on hosted).

create schema evenly;
grant usage on schema evenly to authenticated, service_role;

alter table public.groups set schema evenly;
alter table public.group_members set schema evenly;
alter table public.splits set schema evenly;
alter table private.ai_usage set schema evenly;
drop schema private; -- only held ai_usage

-- Tables outside `public` don't get Supabase's automatic grants: give the site exactly what it uses.
-- Row-level security (moved along with the tables) still limits every row to its owner.
grant select, insert, update, delete on evenly.groups, evenly.group_members, evenly.splits to authenticated;
grant all on evenly.groups, evenly.group_members, evenly.splits, evenly.ai_usage to service_role;
revoke all on evenly.ai_usage from public, authenticated; -- only use_ai() touches it

-- Function bodies name their tables, so they're recreated against the new schema. Dropping the
-- old ones also drops their triggers, which are recreated below.
drop function public.split_saved() cascade;
drop function public.keep_last_splits() cascade;
drop function public.create_group(text, text, text[]);
drop function public.use_ai(text, integer);

create function evenly.split_saved()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger splits_saved before insert or update on evenly.splits
  for each row execute function evenly.split_saved();

-- Keep only the owner's 10 most recently saved splits, across all their groups.
create function evenly.keep_last_splits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from evenly.splits
  where id in (
    select s.id
    from evenly.splits s
    join evenly.groups g on g.id = s.group_id
    where g.owner = (select owner from evenly.groups where id = new.group_id)
    order by s.updated_at desc, s.created_at desc
    offset 10
  );
  return null;
end;
$$;
create trigger splits_keep_last after insert on evenly.splits
  for each row execute function evenly.keep_last_splits();

-- A group and its people in one go. Runs as the caller, so row-level security applies.
create function evenly.create_group(p_name text, p_me text, p_others text[])
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if cardinality(p_others) > 50 then
    raise exception 'A group can have up to 50 people';
  end if;
  insert into evenly.groups (name) values (btrim(p_name)) returning id into v_id;
  if nullif(btrim(p_me), '') is not null then
    insert into evenly.group_members (group_id, name, is_me) values (v_id, btrim(p_me), true);
  end if;
  insert into evenly.group_members (group_id, name)
  select v_id, btrim(n) from unnest(p_others) with ordinality as t (n, ord)
  where btrim(n) <> ''
  order by ord;
  return v_id;
end;
$$;

-- true and counts the call if the caller is under p_daily_limit today, false otherwise.
create function evenly.use_ai(p_kind text, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return false;
  end if;
  insert into evenly.ai_usage as u (user_id, day, kind)
  values ((select auth.uid()), current_date, p_kind)
  on conflict (user_id, day, kind) do update set count = u.count + 1
  where u.count < p_daily_limit;
  return found;
end;
$$;

revoke execute on all functions in schema evenly from public, anon;
grant execute on function evenly.create_group(text, text, text[]), evenly.use_ai(text, integer) to authenticated;
revoke execute on function evenly.split_saved(), evenly.keep_last_splits() from authenticated;
