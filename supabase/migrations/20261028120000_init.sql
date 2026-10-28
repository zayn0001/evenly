-- Split It: your groups of people (just names) and the bill splits saved in them.
-- Every row belongs to the account that created the group; nobody else can see or change it.

-- ---------------------------------------------------------------- groups
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create index groups_owner_idx on public.groups (owner, created_at desc);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- The account holder's own entry, so "I had the biryani" means them.
  is_me boolean not null default false,
  created_at timestamptz not null default now()
);
create index group_members_group_idx on public.group_members (group_id, created_at);
create unique index group_members_one_me on public.group_members (group_id) where is_me;

-- A saved split: the bill, who had what, and what each person's share came to. Names in
-- `result` are a snapshot, so renaming or removing someone later doesn't rewrite old splits.
-- Each account keeps its 10 most recently saved splits; saving an 11th deletes the oldest.
create table public.splits (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  total numeric(12, 2) not null,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  assignments jsonb not null check (jsonb_typeof(assignments) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pg_column_size(receipt) + pg_column_size(assignments) + pg_column_size(result) < 262144)
);
create index splits_group_idx on public.splits (group_id, created_at desc);

create function public.split_saved()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger splits_saved before insert or update on public.splits
  for each row execute function public.split_saved();

-- Keep only the owner's 10 most recently saved splits, across all their groups.
create function public.keep_last_splits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.splits
  where id in (
    select s.id
    from public.splits s
    join public.groups g on g.id = s.group_id
    where g.owner = (select owner from public.groups where id = new.group_id)
    order by s.updated_at desc, s.created_at desc
    offset 10
  );
  return null;
end;
$$;
create trigger splits_keep_last after insert on public.splits
  for each row execute function public.keep_last_splits();

-- ---------------------------------------------------------------- access
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.splits enable row level security;
revoke all on public.groups, public.group_members, public.splits from anon;
revoke execute on function public.split_saved() from public, anon, authenticated;
revoke execute on function public.keep_last_splits() from public, anon, authenticated;

create policy "groups: owner only" on public.groups for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- The subquery runs under groups' own policy, so it only ever finds the caller's groups.
create policy "members: in your groups" on public.group_members for all to authenticated
  using (exists (select 1 from public.groups g where g.id = group_id))
  with check (exists (select 1 from public.groups g where g.id = group_id));

create policy "splits: in your groups" on public.splits for all to authenticated
  using (exists (select 1 from public.groups g where g.id = group_id))
  with check (exists (select 1 from public.groups g where g.id = group_id));

-- A group and its people in one go. Runs as the caller, so the policies above apply.
create function public.create_group(p_name text, p_me text, p_others text[])
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
  insert into public.groups (name) values (btrim(p_name)) returning id into v_id;
  if nullif(btrim(p_me), '') is not null then
    insert into public.group_members (group_id, name, is_me) values (v_id, btrim(p_me), true);
  end if;
  insert into public.group_members (group_id, name)
  select v_id, btrim(n) from unnest(p_others) with ordinality as t (n, ord)
  where btrim(n) <> ''
  order by ord;
  return v_id;
end;
$$;
revoke execute on function public.create_group(text, text, text[]) from public, anon;
grant execute on function public.create_group(text, text, text[]) to authenticated;

-- ---------------------------------------------------------------- AI quota
-- Bill scans and voice splits cost real API calls; the website's API routes count them per
-- user per day here, so the limit holds across serverless instances.
create schema if not exists private;
revoke all on schema private from public;

create table private.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  kind text not null check (kind in ('scan', 'assign')),
  count integer not null default 1,
  primary key (user_id, day, kind)
);

-- true and counts the call if the caller is under p_daily_limit today, false otherwise.
create function public.use_ai(p_kind text, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return false;
  end if;
  insert into private.ai_usage as u (user_id, day, kind)
  values ((select auth.uid()), current_date, p_kind)
  on conflict (user_id, day, kind) do update set count = u.count + 1
  where u.count < p_daily_limit;
  return found;
end;
$$;
revoke execute on function public.use_ai(text, integer) from public, anon;
grant execute on function public.use_ai(text, integer) to authenticated;

